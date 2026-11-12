-- =====================================================================
--  ClassBoard — database, security rules and file storage
--  Paste this whole file into Supabase → SQL Editor → New query → Run.
--  It is safe to run again (it updates functions/policies in place).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. TABLES
-- ---------------------------------------------------------------------

create table if not exists public.boards (
  id                uuid primary key default gen_random_uuid(),
  owner_id          uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title             text not null check (char_length(title) between 1 and 120),
  description       text not null default '' check (char_length(description) <= 2000),
  subject           text not null default 'English' check (char_length(subject) <= 60),
  class_name        text not null default '' check (char_length(class_name) <= 60),
  unit              text not null default '' check (char_length(unit) <= 80),
  lesson            text not null default '' check (char_length(lesson) <= 80),
  cover_path        text,
  theme             text not null default 'sky',
  layout            text not null default 'wall'
                    check (layout in ('wall','grid','shelf','stream','timeline','canvas','storyboard')),
  slug              text not null unique default substr(replace(gen_random_uuid()::text, '-', ''), 1, 12),
  status            text not null default 'active' check (status in ('active','archived')),
  sections          jsonb not null default '[{"id":"s1","title":"Column 1"},{"id":"s2","title":"Column 2"},{"id":"s3","title":"Column 3"}]'::jsonb,
  settings          jsonb not null default '{
      "require_approval": false,
      "allow_posts": true,
      "allow_comments": true,
      "allow_likes": true,
      "allow_stars": false,
      "allow_votes": false,
      "allow_peer_feedback": false,
      "allow_edit_own": true,
      "allow_uploads": true,
      "allow_audio": true,
      "posting_locked": false,
      "show_names": true,
      "show_leaderboard": false
  }'::jsonb,
  spotlight_post_id uuid,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

-- Teacher-only data kept apart from the board so students can never read it.
create table if not exists public.board_secrets (
  board_id     uuid primary key references public.boards(id) on delete cascade,
  access_code  text check (access_code is null or char_length(access_code) <= 20),
  roster       text[] not null default '{}'
);

create table if not exists public.board_members (
  board_id      uuid not null references public.boards(id) on delete cascade,
  user_id       uuid not null references auth.users(id) on delete cascade,
  display_name  text not null check (char_length(display_name) between 1 and 40),
  class_name    text not null default '' check (char_length(class_name) <= 30),
  joined_at     timestamptz not null default now(),
  primary key (board_id, user_id)
);

create table if not exists public.posts (
  id           uuid primary key default gen_random_uuid(),
  board_id     uuid not null references public.boards(id) on delete cascade,
  author_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  author_name  text not null default '',
  is_teacher   boolean not null default false,
  kind         text not null default 'note'
               check (kind in ('note','vocab','reading','spelling','grammar','writing','speaking','activity','response')),
  parent_id    uuid references public.posts(id) on delete cascade,
  title        text not null default '' check (char_length(title) <= 200),
  body         text not null default '' check (char_length(body) <= 20000),
  link_url     text check (link_url is null or char_length(link_url) <= 1000),
  video_url    text check (video_url is null or char_length(video_url) <= 1000),
  attachments  jsonb not null default '[]'::jsonb check (jsonb_typeof(attachments) = 'array' and jsonb_array_length(attachments) <= 10),
  data         jsonb not null default '{}'::jsonb,
  section_id   text,
  pos_x        integer,
  pos_y        integer,
  sort_order   double precision not null default extract(epoch from clock_timestamp()),
  event_date   date,
  connections  jsonb not null default '[]'::jsonb,
  visibility   text not null default 'board' check (visibility in ('board','teacher')),
  status       text not null default 'approved' check (status in ('pending','approved','rejected')),
  is_open      boolean not null default true,
  pinned       boolean not null default false,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists posts_board_idx  on public.posts(board_id);
create index if not exists posts_parent_idx on public.posts(parent_id);

-- Correct answers for activities. Teacher-only: students never receive them.
create table if not exists public.activity_keys (
  post_id   uuid primary key references public.posts(id) on delete cascade,
  board_id  uuid not null references public.boards(id) on delete cascade,
  answers   jsonb not null default '[]'::jsonb
);

-- Marks and private teacher feedback. Visible only to the teacher and that one student.
create table if not exists public.assessments (
  post_id     uuid primary key references public.posts(id) on delete cascade,
  board_id    uuid not null references public.boards(id) on delete cascade,
  student_id  uuid not null references auth.users(id) on delete cascade,
  auto_score  numeric,
  auto_total  numeric,
  mark        text check (mark is null or char_length(mark) <= 20),
  feedback    text check (feedback is null or char_length(feedback) <= 4000),
  updated_at  timestamptz not null default now()
);
create index if not exists assessments_board_idx on public.assessments(board_id);

create table if not exists public.comments (
  id           uuid primary key default gen_random_uuid(),
  post_id      uuid not null references public.posts(id) on delete cascade,
  board_id     uuid not null references public.boards(id) on delete cascade,
  author_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  author_name  text not null default '',
  is_teacher   boolean not null default false,
  kind         text not null default 'comment' check (kind in ('comment','peer')),
  body         text not null check (char_length(body) between 1 and 1000),
  created_at   timestamptz not null default now()
);
create index if not exists comments_board_idx on public.comments(board_id);

create table if not exists public.reactions (
  post_id     uuid not null references public.posts(id) on delete cascade,
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  board_id    uuid not null references public.boards(id) on delete cascade,
  kind        text not null check (kind in ('like','star','vote')),
  value       smallint not null default 1 check (value between 1 and 5),
  created_at  timestamptz not null default now(),
  primary key (post_id, user_id, kind)
);
create index if not exists reactions_board_idx on public.reactions(board_id);

-- ---------------------------------------------------------------------
-- 2. HELPER FUNCTIONS (security definer = they can look without recursion)
-- ---------------------------------------------------------------------

create or replace function public.is_teacher_user() returns boolean
language sql stable as $$
  select auth.uid() is not null
     and coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) = false
$$;

create or replace function public.is_board_owner(b uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from boards where id = b and owner_id = auth.uid())
$$;

create or replace function public.is_board_member(b uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from board_members where board_id = b and user_id = auth.uid())
$$;

create or replace function public.can_view_board(b uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_board_owner(b) or public.is_board_member(b)
$$;

create or replace function public.can_see_post(p uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from posts x
    where x.id = p
      and ( public.is_board_owner(x.board_id)
            or ( public.is_board_member(x.board_id)
                 and ( x.author_id = auth.uid()
                       or (x.status = 'approved' and x.visibility = 'board') ) ) )
  )
$$;

create or replace function public.board_setting(b public.boards, key text, dflt boolean) returns boolean
language sql immutable as $$
  select coalesce((b.settings ->> key)::boolean, dflt)
$$;

-- Text versions used by storage rules (paths are text; bad paths simply return false)
create or replace function public.storage_can_read(folder text[]) returns boolean
language sql stable security definer set search_path = public as $$
  select case
    when folder[1] = 'b' then exists (
      select 1 from boards bb where bb.id::text = folder[2]
        and (bb.owner_id = auth.uid()
             or exists (select 1 from board_members m where m.board_id = bb.id and m.user_id = auth.uid())))
    when folder[1] = 't' then
      folder[2] = auth.uid()::text
      or exists (select 1 from boards bb join board_members m on m.board_id = bb.id
                 where bb.owner_id::text = folder[2] and m.user_id = auth.uid())
    else false end
$$;

create or replace function public.storage_can_write(folder text[]) returns boolean
language sql stable security definer set search_path = public as $$
  select case
    when folder[1] = 't' then folder[2] = auth.uid()::text and public.is_teacher_user()
    when folder[1] = 'b' then folder[3] = auth.uid()::text and exists (
      select 1 from boards bb where bb.id::text = folder[2] and bb.status = 'active'
        and (bb.owner_id = auth.uid()
             or (exists (select 1 from board_members m where m.board_id = bb.id and m.user_id = auth.uid())
                 and coalesce((bb.settings->>'posting_locked')::boolean, false) = false)))
    else false end
$$;

create or replace function public.storage_can_delete(folder text[]) returns boolean
language sql stable security definer set search_path = public as $$
  select case
    when folder[1] = 't' then folder[2] = auth.uid()::text
    when folder[1] = 'b' then folder[3] = auth.uid()::text
         or exists (select 1 from boards bb where bb.id::text = folder[2] and bb.owner_id = auth.uid())
    else false end
$$;

-- Text normaliser used for automatic checking of typed answers
create or replace function public.norm_answer(t text, strict boolean default false) returns text
language sql immutable as $$
  select case when strict then
      regexp_replace(trim(replace(replace(coalesce(t,''), '’', ''''), '‘', '''')), '\s+', ' ', 'g')
    else
      regexp_replace(regexp_replace(lower(trim(replace(replace(coalesce(t,''), '’', ''''), '‘', ''''))), '\s+', ' ', 'g'), '[.!?,;:]+$', '')
    end
$$;

-- ---------------------------------------------------------------------
-- 3. TRIGGERS (server-side rules students cannot get around)
-- ---------------------------------------------------------------------

create or replace function public.tg_touch() returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;

drop trigger if exists boards_touch on public.boards;
create trigger boards_touch before update on public.boards for each row execute function public.tg_touch();

create or replace function public.tg_board_created() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into board_secrets(board_id) values (new.id) on conflict do nothing;
  return new;
end $$;

drop trigger if exists boards_created on public.boards;
create trigger boards_created after insert on public.boards for each row execute function public.tg_board_created();

create or replace function public.tg_posts_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  b public.boards;
  par public.posts;
  is_owner boolean;
  mname text;
  needs_ok boolean;
begin
  select * into b from boards where id = new.board_id;
  if not found then raise exception 'Board not found'; end if;
  is_owner := (b.owner_id = auth.uid());
  needs_ok := public.board_setting(b, 'require_approval', false);

  if tg_op = 'INSERT' then
    new.author_id := auth.uid();
    new.updated_at := now();
    if is_owner then
      new.is_teacher := true;
      if coalesce(new.author_name, '') = '' then new.author_name := 'Teacher'; end if;
      if new.kind = 'response' and new.parent_id is null then raise exception 'Response needs a parent'; end if;
      return new;
    end if;

    -- Student insert
    select display_name into mname from board_members where board_id = new.board_id and user_id = auth.uid();
    if mname is null then raise exception 'Please join this board first'; end if;
    if b.status <> 'active' then raise exception 'This board is closed'; end if;
    if public.board_setting(b, 'posting_locked', false) then raise exception 'Your teacher has paused posting'; end if;
    if new.kind not in ('note','response') then raise exception 'Students can only add posts and answers'; end if;

    new.author_name := mname;
    new.is_teacher  := false;
    new.pinned      := false;
    new.is_open     := true;
    new.connections := '[]'::jsonb;
    new.status      := case when needs_ok then 'pending' else 'approved' end;

    if new.kind = 'note' then
      if not public.board_setting(b, 'allow_posts', true) then raise exception 'Posting new notes is turned off'; end if;
      new.parent_id  := null;
      new.visibility := 'board';
      new.data := jsonb_strip_nulls(jsonb_build_object('color', new.data -> 'color'));
    else
      select * into par from posts where id = new.parent_id and board_id = new.board_id;
      if not found then raise exception 'Task not found'; end if;
      if par.kind in ('note','response') then raise exception 'You cannot answer this post'; end if;
      if not par.is_open then raise exception 'This task is closed'; end if;
      if par.kind = 'activity' and coalesce(current_setting('app.activity_submit', true), '') <> '1' then
        raise exception 'Use the activity Submit button';
      end if;
      new.visibility := case when par.kind <> 'activity' and coalesce((par.data->>'share_responses')::boolean, false)
                             then 'board' else 'teacher' end;
      new.data := jsonb_strip_nulls(jsonb_build_object('answers', new.data -> 'answers'));
    end if;
    return new;
  end if;

  -- UPDATE
  new.updated_at := now();
  if is_owner then return new; end if;

  if b.status <> 'active' then raise exception 'This board is closed'; end if;
  if public.board_setting(b, 'posting_locked', false) then raise exception 'Your teacher has paused posting'; end if;
  if old.kind = 'response' and coalesce(current_setting('app.activity_submit', true), '') <> '1' then
    select * into par from posts where id = old.parent_id;
    if par.kind = 'activity' then raise exception 'Activity answers cannot be edited'; end if;
    if not par.is_open then raise exception 'This task is closed'; end if;
  end if;

  -- Protected fields stay as they were
  new.id := old.id; new.board_id := old.board_id; new.author_id := old.author_id;
  new.author_name := old.author_name; new.is_teacher := old.is_teacher; new.kind := old.kind;
  new.parent_id := old.parent_id; new.visibility := old.visibility; new.pinned := old.pinned;
  new.is_open := old.is_open; new.connections := old.connections; new.created_at := old.created_at;
  new.sort_order := old.sort_order;
  if old.kind = 'note' then
    new.data := jsonb_strip_nulls(jsonb_build_object('color', new.data -> 'color'));
  else
    new.data := jsonb_strip_nulls(jsonb_build_object('answers', new.data -> 'answers'));
  end if;

  if (new.title, new.body, new.attachments, new.link_url, new.video_url, new.data)
     is distinct from (old.title, old.body, old.attachments, old.link_url, old.video_url, old.data) then
    new.status := case when needs_ok then 'pending' else old.status end;
    if old.status = 'rejected' and not needs_ok then new.status := 'approved'; end if;
  else
    new.status := old.status;
  end if;
  return new;
end $$;

drop trigger if exists posts_guard on public.posts;
create trigger posts_guard before insert or update on public.posts for each row execute function public.tg_posts_guard();

create or replace function public.tg_comments_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare b public.boards; p public.posts; mname text;
begin
  select * into p from posts where id = new.post_id;
  if not found then raise exception 'Post not found'; end if;
  select * into b from boards where id = p.board_id;
  new.board_id := p.board_id;
  new.author_id := auth.uid();
  if b.owner_id = auth.uid() then
    new.is_teacher := true;
    if coalesce(new.author_name,'') = '' then new.author_name := 'Teacher'; end if;
    return new;
  end if;
  select display_name into mname from board_members where board_id = b.id and user_id = auth.uid();
  if mname is null then raise exception 'Please join this board first'; end if;
  if b.status <> 'active' then raise exception 'This board is closed'; end if;
  if public.board_setting(b, 'posting_locked', false) then raise exception 'Your teacher has paused posting'; end if;
  if new.kind = 'comment' and not public.board_setting(b, 'allow_comments', true) then raise exception 'Comments are turned off'; end if;
  if new.kind = 'peer' and not public.board_setting(b, 'allow_peer_feedback', false) then raise exception 'Peer feedback is turned off'; end if;
  new.author_name := mname;
  new.is_teacher := false;
  return new;
end $$;

drop trigger if exists comments_guard on public.comments;
create trigger comments_guard before insert on public.comments for each row execute function public.tg_comments_guard();

create or replace function public.tg_reactions_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare b public.boards; bid uuid;
begin
  select board_id into bid from posts where id = new.post_id;
  if bid is null then raise exception 'Post not found'; end if;
  select * into b from boards where id = bid;
  new.board_id := bid;
  new.user_id := auth.uid();
  if new.kind <> 'star' then new.value := 1; end if;
  if b.owner_id = auth.uid() then return new; end if;
  if b.status <> 'active' then raise exception 'This board is closed'; end if;
  if new.kind = 'like' and not public.board_setting(b, 'allow_likes', true)  then raise exception 'Likes are turned off'; end if;
  if new.kind = 'star' and not public.board_setting(b, 'allow_stars', false) then raise exception 'Star ratings are turned off'; end if;
  if new.kind = 'vote' and not public.board_setting(b, 'allow_votes', false) then raise exception 'Voting is turned off'; end if;
  return new;
end $$;

drop trigger if exists reactions_guard on public.reactions;
create trigger reactions_guard before insert or update on public.reactions for each row execute function public.tg_reactions_guard();

create or replace function public.tg_assessments_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare p public.posts;
begin
  select * into p from posts where id = new.post_id;
  if not found then raise exception 'Submission not found'; end if;
  new.board_id := p.board_id;
  new.student_id := p.author_id;
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists assessments_guard on public.assessments;
create trigger assessments_guard before insert or update on public.assessments for each row execute function public.tg_assessments_guard();

create or replace function public.tg_keys_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  select board_id into new.board_id from posts where id = new.post_id;
  return new;
end $$;

drop trigger if exists keys_guard on public.activity_keys;
create trigger keys_guard before insert or update on public.activity_keys for each row execute function public.tg_keys_guard();

-- ---------------------------------------------------------------------
-- 4. ROW LEVEL SECURITY
-- ---------------------------------------------------------------------

alter table public.boards        enable row level security;
alter table public.board_secrets enable row level security;
alter table public.board_members enable row level security;
alter table public.posts         enable row level security;
alter table public.activity_keys enable row level security;
alter table public.assessments   enable row level security;
alter table public.comments      enable row level security;
alter table public.reactions     enable row level security;

-- boards
drop policy if exists boards_select on public.boards;
drop policy if exists boards_insert on public.boards;
drop policy if exists boards_update on public.boards;
drop policy if exists boards_delete on public.boards;
create policy boards_select on public.boards for select to authenticated
  using (owner_id = auth.uid() or public.is_board_member(id));
create policy boards_insert on public.boards for insert to authenticated
  with check (owner_id = auth.uid() and public.is_teacher_user());
create policy boards_update on public.boards for update to authenticated
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy boards_delete on public.boards for delete to authenticated
  using (owner_id = auth.uid());

-- board_secrets (teacher only)
drop policy if exists secrets_all on public.board_secrets;
create policy secrets_all on public.board_secrets for all to authenticated
  using (public.is_board_owner(board_id)) with check (public.is_board_owner(board_id));

-- board_members (students join through join_board(); teacher can remove)
drop policy if exists members_select on public.board_members;
drop policy if exists members_delete on public.board_members;
create policy members_select on public.board_members for select to authenticated
  using (public.is_board_owner(board_id) or user_id = auth.uid());
create policy members_delete on public.board_members for delete to authenticated
  using (public.is_board_owner(board_id));

-- posts
drop policy if exists posts_select on public.posts;
drop policy if exists posts_insert on public.posts;
drop policy if exists posts_update on public.posts;
drop policy if exists posts_delete on public.posts;
create policy posts_select on public.posts for select to authenticated
  using ( public.is_board_owner(board_id)
          or ( public.is_board_member(board_id)
               and ( author_id = auth.uid() or (status = 'approved' and visibility = 'board') ) ) );
create policy posts_insert on public.posts for insert to authenticated
  with check ( author_id = auth.uid()
               and (public.is_board_owner(board_id) or public.is_board_member(board_id)) );
create policy posts_update on public.posts for update to authenticated
  using ( public.is_board_owner(board_id)
          or ( author_id = auth.uid()
               and exists (select 1 from public.boards b where b.id = board_id
                           and public.board_setting(b, 'allow_edit_own', true)) ) )
  with check ( public.is_board_owner(board_id) or author_id = auth.uid() );
create policy posts_delete on public.posts for delete to authenticated
  using ( public.is_board_owner(board_id)
          or ( author_id = auth.uid()
               and exists (select 1 from public.boards b where b.id = board_id
                           and b.status = 'active'
                           and public.board_setting(b, 'allow_edit_own', true)
                           and not public.board_setting(b, 'posting_locked', false)) ) );

-- activity_keys (teacher only)
drop policy if exists keys_all on public.activity_keys;
create policy keys_all on public.activity_keys for all to authenticated
  using (public.is_board_owner(board_id))
  with check (exists (select 1 from public.posts p where p.id = post_id and public.is_board_owner(p.board_id)));

-- assessments (teacher writes; teacher + that student read)
drop policy if exists assess_select on public.assessments;
drop policy if exists assess_write  on public.assessments;
drop policy if exists assess_update on public.assessments;
drop policy if exists assess_delete on public.assessments;
create policy assess_select on public.assessments for select to authenticated
  using (public.is_board_owner(board_id) or student_id = auth.uid());
create policy assess_write on public.assessments for insert to authenticated
  with check (exists (select 1 from public.posts p where p.id = post_id and public.is_board_owner(p.board_id)));
create policy assess_update on public.assessments for update to authenticated
  using (public.is_board_owner(board_id))
  with check (exists (select 1 from public.posts p where p.id = post_id and public.is_board_owner(p.board_id)));
create policy assess_delete on public.assessments for delete to authenticated
  using (public.is_board_owner(board_id));

-- comments
drop policy if exists comments_select on public.comments;
drop policy if exists comments_insert on public.comments;
drop policy if exists comments_delete on public.comments;
create policy comments_select on public.comments for select to authenticated
  using (public.can_see_post(post_id));
create policy comments_insert on public.comments for insert to authenticated
  with check (author_id = auth.uid() and public.can_see_post(post_id));
create policy comments_delete on public.comments for delete to authenticated
  using (author_id = auth.uid() or public.is_board_owner(board_id));

-- reactions
drop policy if exists reactions_select on public.reactions;
drop policy if exists reactions_insert on public.reactions;
drop policy if exists reactions_update on public.reactions;
drop policy if exists reactions_delete on public.reactions;
create policy reactions_select on public.reactions for select to authenticated
  using (public.can_view_board(board_id));
create policy reactions_insert on public.reactions for insert to authenticated
  with check (user_id = auth.uid() and public.can_see_post(post_id));
create policy reactions_update on public.reactions for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy reactions_delete on public.reactions for delete to authenticated
  using (user_id = auth.uid() or public.is_board_owner(board_id));

-- ---------------------------------------------------------------------
-- 5. FUNCTIONS CALLED FROM THE WEBSITE
-- ---------------------------------------------------------------------

-- What a student sees before joining (no secrets).
create or replace function public.board_preview(p_slug text) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'id', b.id, 'title', b.title, 'description', b.description, 'class_name', b.class_name,
    'subject', b.subject, 'theme', b.theme, 'status', b.status,
    'needs_code', coalesce(nullif(trim(s.access_code), ''), null) is not null)
  from boards b left join board_secrets s on s.board_id = b.id
  where b.slug = p_slug
$$;

create or replace function public.join_board(p_slug text, p_code text, p_name text, p_class text) returns uuid
language plpgsql security definer set search_path = public as $$
declare b boards; code text; nm text; cl text;
begin
  if auth.uid() is null then raise exception 'Please refresh the page and try again'; end if;
  select * into b from boards where slug = p_slug;
  if not found then raise exception 'Board not found. Check the link.'; end if;
  if b.owner_id = auth.uid() then return b.id; end if;
  if b.status <> 'active' then raise exception 'This board is closed'; end if;
  select access_code into code from board_secrets where board_id = b.id;
  if coalesce(trim(code), '') <> '' and upper(trim(coalesce(p_code, ''))) <> upper(trim(code)) then
    raise exception 'That class code is not right. Ask your teacher.';
  end if;
  nm := regexp_replace(trim(coalesce(p_name, '')), '\s+', ' ', 'g');
  cl := trim(coalesce(p_class, ''));
  if char_length(nm) < 1 or char_length(nm) > 40 then raise exception 'Please type your first name'; end if;
  if char_length(cl) > 30 then raise exception 'Class name is too long'; end if;
  insert into board_members(board_id, user_id, display_name, class_name)
  values (b.id, auth.uid(), nm, cl)
  on conflict (board_id, user_id) do update set display_name = excluded.display_name, class_name = excluded.class_name;
  update posts set author_name = nm where board_id = b.id and author_id = auth.uid() and author_name <> nm;
  update comments set author_name = nm where board_id = b.id and author_id = auth.uid() and author_name <> nm;
  return b.id;
end $$;

-- Checks an activity on the server (answer keys never leave the database).
create or replace function public.submit_activity(p_post uuid, p_answers jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  a posts; b boards; keys jsonb; q jsonb; k jsonb; ans jsonb; t text;
  i int; n int; total int := 0; score int := 0; results jsonb := '[]'::jsonb;
  ok boolean; rid uuid; alt text;
begin
  select * into a from posts where id = p_post and kind = 'activity';
  if not found then raise exception 'Activity not found'; end if;
  select * into b from boards where id = a.board_id;
  if not (b.owner_id = auth.uid() or public.is_board_member(b.id)) then raise exception 'Please join this board first'; end if;
  if b.owner_id = auth.uid() then raise exception 'Teachers preview activities without submitting'; end if;
  if not a.is_open then raise exception 'This activity is closed'; end if;
  if jsonb_typeof(p_answers) <> 'array' then raise exception 'Answers missing'; end if;

  select answers into keys from activity_keys where post_id = p_post;
  keys := coalesce(keys, '[]'::jsonb);
  n := coalesce(jsonb_array_length(a.data -> 'questions'), 0);

  for i in 0 .. n - 1 loop
    q := a.data -> 'questions' -> i;
    t := q ->> 'type';
    k := keys -> i;
    ans := p_answers -> i;
    if t = 'short' or k is null or jsonb_typeof(k) = 'null' then
      results := results || 'null'::jsonb;
      continue;
    end if;
    total := total + 1;
    ok := false;
    if ans is not null and jsonb_typeof(ans) <> 'null' then
      if t in ('mcq', 'tf') then
        ok := (ans #>> '{}') = (k #>> '{}');
      elsif t in ('fill', 'spell') then
        foreach alt in array string_to_array(k #>> '{}', '|') loop
          if public.norm_answer(ans #>> '{}') = public.norm_answer(alt) then ok := true; end if;
        end loop;
      elsif t in ('correct', 'build') then
        foreach alt in array string_to_array(k #>> '{}', '|') loop
          if public.norm_answer(ans #>> '{}', true) = public.norm_answer(alt, true) then ok := true; end if;
        end loop;
      end if;
    end if;
    if ok then score := score + 1; end if;
    results := results || to_jsonb(ok);
  end loop;

  perform set_config('app.activity_submit', '1', true);
  select id into rid from posts where parent_id = p_post and author_id = auth.uid() and kind = 'response' limit 1;
  if rid is null then
    insert into posts(board_id, kind, parent_id, title, data)
    values (a.board_id, 'response', p_post, a.title, jsonb_build_object('answers', p_answers))
    returning id into rid;
  else
    if not coalesce((a.data ->> 'allow_retry')::boolean, true) then
      perform set_config('app.activity_submit', '0', true);
      raise exception 'You have already finished this activity';
    end if;
    update posts set data = jsonb_build_object('answers', p_answers) where id = rid;
  end if;
  perform set_config('app.activity_submit', '0', true);

  insert into assessments(post_id, board_id, student_id, auto_score, auto_total)
  values (rid, a.board_id, auth.uid(), score, total)
  on conflict (post_id) do update set auto_score = excluded.auto_score, auto_total = excluded.auto_total;

  return jsonb_build_object('score', score, 'total', total, 'results', results, 'response_id', rid,
                            'keys', case when coalesce((a.data ->> 'show_answers')::boolean, true) then keys else null end);
end $$;

-- Progress and (optional) leaderboard. Students only see everyone if the teacher allows it.
create or replace function public.board_progress(p_board uuid)
returns table(user_id uuid, display_name text, class_name text, posts int, responses int,
              activities int, score numeric, total numeric, audio int)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
declare b boards; see_all boolean;
begin
  select * into b from boards where id = p_board;
  if not found or not public.can_view_board(p_board) then return; end if;
  see_all := b.owner_id = auth.uid() or public.board_setting(b, 'show_leaderboard', false);
  return query
    select m.user_id, m.display_name, m.class_name,
      (select count(*)::int from posts p where p.board_id = p_board and p.author_id = m.user_id and p.kind = 'note' and p.status = 'approved'),
      (select count(*)::int from posts p where p.board_id = p_board and p.author_id = m.user_id and p.kind = 'response'
          and exists (select 1 from posts q where q.id = p.parent_id and q.kind <> 'activity')),
      (select count(*)::int from posts p where p.board_id = p_board and p.author_id = m.user_id and p.kind = 'response'
          and exists (select 1 from posts q where q.id = p.parent_id and q.kind = 'activity')),
      coalesce((select sum(a.auto_score) from assessments a where a.board_id = p_board and a.student_id = m.user_id), 0),
      coalesce((select sum(a.auto_total) from assessments a where a.board_id = p_board and a.student_id = m.user_id), 0),
      (select count(*)::int from posts p, jsonb_array_elements(p.attachments) e
          where p.board_id = p_board and p.author_id = m.user_id and e->>'type' like 'audio/%')
    from board_members m
    where m.board_id = p_board and (see_all or m.user_id = auth.uid())
    order by m.display_name;
end $$;

-- Copy a board with all teacher content (not student work).
create or replace function public.duplicate_board(p_board uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare b boards; nb uuid; r posts; np uuid; idmap jsonb := '{}'::jsonb;
begin
  select * into b from boards where id = p_board and owner_id = auth.uid();
  if not found then raise exception 'Board not found'; end if;
  insert into boards(owner_id, title, description, subject, class_name, unit, lesson, cover_path, theme, layout, sections, settings)
  values (auth.uid(), left(b.title || ' (copy)', 120), b.description, b.subject, b.class_name, b.unit, b.lesson,
          b.cover_path, b.theme, b.layout, b.sections, b.settings || '{"posting_locked": false}'::jsonb)
  returning id into nb;
  update board_secrets s set access_code = o.access_code, roster = o.roster
    from board_secrets o where o.board_id = p_board and s.board_id = nb;
  for r in select * from posts where board_id = p_board and is_teacher and parent_id is null order by sort_order loop
    insert into posts(board_id, author_name, kind, title, body, link_url, video_url, attachments, data,
                      section_id, pos_x, pos_y, sort_order, event_date, visibility, status, is_open, pinned)
    values (nb, r.author_name, r.kind, r.title, r.body, r.link_url, r.video_url, r.attachments, r.data,
            r.section_id, r.pos_x, r.pos_y, r.sort_order, r.event_date, r.visibility, 'approved', r.is_open, r.pinned)
    returning id into np;
    idmap := idmap || jsonb_build_object(r.id::text, np::text);
    insert into activity_keys(post_id, board_id, answers)
      select np, nb, k.answers from activity_keys k where k.post_id = r.id;
  end loop;
  -- re-point canvas connections to the new copies
  update posts p set connections = coalesce((
      select jsonb_agg(idmap ->> c) from jsonb_array_elements_text(p.connections) c where idmap ? c), '[]'::jsonb)
    where p.board_id = nb;
  return nb;
end $$;

-- ---------------------------------------------------------------------
-- 6. PERMISSIONS
-- ---------------------------------------------------------------------

grant usage on schema public to anon, authenticated;
revoke all on public.boards, public.board_secrets, public.board_members, public.posts,
              public.activity_keys, public.assessments, public.comments, public.reactions from anon;
grant select, insert, update, delete on public.boards, public.board_secrets, public.board_members,
      public.posts, public.activity_keys, public.assessments, public.comments, public.reactions to authenticated;

revoke execute on function public.board_preview(text) from public;
revoke execute on function public.join_board(text, text, text, text) from public;
revoke execute on function public.submit_activity(uuid, jsonb) from public;
revoke execute on function public.board_progress(uuid) from public;
revoke execute on function public.duplicate_board(uuid) from public;
grant execute on function public.board_preview(text) to anon, authenticated;
grant execute on function public.join_board(text, text, text, text) to authenticated;
grant execute on function public.submit_activity(uuid, jsonb) to authenticated;
grant execute on function public.board_progress(uuid) to authenticated;
grant execute on function public.duplicate_board(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 7. LIVE UPDATES (Supabase Realtime)
-- ---------------------------------------------------------------------

alter table public.posts     replica identity full;
alter table public.comments  replica identity full;
alter table public.reactions replica identity full;

do $$
declare t text;
begin
  foreach t in array array['boards','posts','comments','reactions','board_members','assessments'] loop
    if not exists (select 1 from pg_publication_tables
                   where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- 8. FILE STORAGE (private bucket; size + type checked by the server)
--    Paths:  t/<teacher-id>/<file>            teacher materials
--            b/<board-id>/<user-id>/<file>    work posted on a board
-- ---------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('classroom', 'classroom', false, 20971520, array[
  'image/png','image/jpeg','image/gif','image/webp',
  'audio/webm','audio/ogg','audio/mp4','audio/mpeg','audio/wav','audio/x-wav','audio/aac','audio/x-m4a',
  'video/mp4','video/webm','video/quicktime',
  'application/pdf',
  'application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-powerpoint','application/vnd.openxmlformats-officedocument.presentationml.presentation'
])
on conflict (id) do update set public = excluded.public,
  file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists classroom_read   on storage.objects;
drop policy if exists classroom_insert on storage.objects;
drop policy if exists classroom_delete on storage.objects;
create policy classroom_read on storage.objects for select to authenticated
  using (bucket_id = 'classroom' and public.storage_can_read(storage.foldername(name)));
create policy classroom_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'classroom' and public.storage_can_write(storage.foldername(name)));
create policy classroom_delete on storage.objects for delete to authenticated
  using (bucket_id = 'classroom' and public.storage_can_delete(storage.foldername(name)));

-- Done.
