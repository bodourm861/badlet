# 🧸 ClassBoard: a free collaboration board for English classes

ClassBoard is a working website for you and your Grade 4 English students. It is inspired by Padlet, but it has its own design. You make boards, share one link in Microsoft Teams, and students join with their first name. They post, record their voices, answer activities, and comment. Every answer appears on your dashboard straight away.

The whole system runs on free plans:

| Part | Service | Cost |
|---|---|---|
| Website files (HTML, CSS, JavaScript) | Netlify, Cloudflare Pages or GitHub Pages | Free |
| Database, sign-in, file storage, live updates | Supabase free plan | Free |
| Audio recording | The browser's built-in MediaRecorder | Free |
| "Listen" buttons (text-to-speech) | The browser's built-in voices | Free |

There is no build step and nothing to install. You upload the folder as it is.

---

## Contents
1. [What it does](#1-what-it-does)
2. [Set up: about 20 minutes, one time only](#2-set-up-about-20-minutes-one-time-only)
3. [Make your first board](#3-make-your-first-board)
4. [Share a board in Microsoft Teams](#4-share-a-board-in-microsoft-teams)
5. [Teacher cheat sheet](#5-teacher-cheat-sheet)
6. [Free-plan limits](#6-free-plan-limits)
7. [Known limitations](#7-known-limitations)
8. [Security and privacy](#8-security-and-privacy)
9. [Troubleshooting](#9-troubleshooting)
10. [How it was tested](#10-how-it-was-tested)
11. [Files](#11-files)

---

## 1. What it does

**Teacher dashboard**
- Create, edit, duplicate, archive, restore and delete boards.
- Give each board a title, description, subject, class, unit, lesson and cover picture.
- Boards are grouped by class and unit. You can search and filter them.
- Each board has a share link and an optional class code.
- Each board shows how many posts are waiting for your approval.

**Seven layouts.** You can switch layouts at any time and no content is lost.
- 🧱 Wall: sticky notes
- ▦ Grid: equal cards
- 🗂️ Shelf: columns. You can add, rename, reorder and delete columns.
- 📜 Stream: one feed
- ⏳ Timeline: cards ordered by date
- 🧠 Canvas: drag cards anywhere and draw lines between ideas
- 🎬 Storyboard: numbered frames in order

**Students**
- Students join with a link, their first name, their class and an optional class code. They do not need accounts or email addresses.
- They can post text, pictures, PDF, Word and PowerPoint files, video uploads, YouTube or Vimeo links, website links, drawings or handwriting, and voice recordings.
- They can like, rate with stars, vote, comment and give peer feedback ("I like… / Next time…"). You turn each of these on or off separately.
- They can edit or delete their own posts if you allow it. They can **never** change anyone else's work or reach teacher controls.

**Audio recorder.** It has Start, Stop, Play, Re-record and Submit buttons, with a timer and a 3-minute limit. It also gives clear messages when the microphone is blocked.

**English tools** (choose them from **＋ Add** on a board)
- 🔤 **Vocabulary cards**: the word, its meaning and an example sentence, each with a 🔊 Listen button. You can add a picture and your own voice. Students record themselves saying the word. You can also add many cards at once with one line per word.
- 📖 **Reading**: the passage is shown in large type. Students can listen to your recording or the computer voice. They record themselves reading, then type answers to your comprehension questions.
- 🐝 **Spelling**: each word has a 🔊 button. There is a self-check practice game, and students can record themselves spelling. A **teacher-controlled spelling challenge** is also available: students hear each word and type it, and you open and close the challenge.
- 🧩 **Grammar**: an explanation, examples with 🔊 buttons and a picture, plus quizzes (see Activities below).
- ✏️ **Writing**: a prompt and a writing box with a word counter, plus an optional picture or drawing. You give private feedback. You can let the class see each other's writing as cards.
- 🗣️ **Speaking**: a prompt, and students record oral answers that you listen to.

**Activities and games**
- Templates: vocabulary challenge, picture identification, sentence building (tap the words in order), grammar quiz, spelling challenge, reading comprehension, true or false, exit ticket, and brainstorm.
- Question types: multiple choice, true/false, fill in the blank, correct the sentence, spelling (listen and type), build the sentence, and open answer.
- **Answers are checked on the server.** The correct answers are never sent to students' browsers.
- Students see their score straight away. You choose whether they can try again and whether they see the correct answers.

**Live teacher control**
- 🔒 Pause and resume all student posting.
- 🟢/🔴 Open or close each task or activity.
- 🖥️ **Show to the class**: one post opens full-screen on every student's device.
- ✅ Approval mode: new posts wait for you before classmates can see them.
- 👀 Student view: see the board exactly as students see it.

**Monitoring and marks** (the **📊 Monitor** button on a board)
- See who joined, who answered each task, and **who has not submitted yet**. This works best after you paste your class list.
- Review each answer in one place: play recordings, read text, see each quiz answer marked ✅/❌, approve or reject, and type a **mark** and **private feedback**.
- Marks are only ever what you type. Nothing is graded just for taking part.
- Export to **CSV**, which opens in Excel: one file has a row per student per task, and the other is a participation summary.

**Progress and leaderboard**
- Each student has a "⭐ My work" page with points, badges, a to-do list, and your feedback.
- A class leaderboard is optional and **off by default**, so rankings stay private.

---

## 2. Set up: about 20 minutes, one time only

### Step 1: Create the free database (Supabase)
1. Go to **https://supabase.com** and click **Start your project**. Sign up for free; no card is needed.
2. Click **New project**. Pick a name, for example `classboard`, and a strong database password (keep it safe). Choose the **region closest to your school**, then click **Create**. Wait about 2 minutes.
3. In the left menu, open **SQL Editor** and click **New query**.
4. Open the file `supabase/schema.sql` from this folder, copy **all** of it, paste it in, and click **Run**. You should see "Success. No rows returned".
   This creates the tables, the security rules, the private file storage and the live updates. It is safe to run again later.

### Step 2: Switch on student joining and set the limits
In Supabase, open **Authentication**:
1. **Sign In / Providers**: turn on **Allow anonymous sign-ins** and click **Save**. Students need this to join without accounts.
2. **Rate Limits**: find the limit for **anonymous sign-ins**. It is **30 per hour per IP address** by default, and a whole school on one Wi-Fi network counts as one IP address. Raise it to about **300** and click **Save**.
3. **Sign In / Providers → Email**: keep **Confirm email** on. You will confirm your own teacher account once by email. If the confirmation email does not arrive, you can turn it off, create your account, then turn it back on. The free built-in email service only sends a few emails per hour.

### Step 3: Connect the website to the database
1. In Supabase, open **Project Settings → API** (on newer projects it is called **API Keys**).
2. Copy the **Project URL** and the **anon public** key. On newer projects, copy the **publishable** key instead.
3. Open `js/config.js` in any text editor, such as Notepad or TextEdit, and paste the two values:
   ```js
   export const SUPABASE_URL = 'https://abcdefghijk.supabase.co';
   export const SUPABASE_KEY = 'eyJhbGciOi...';   // anon / publishable key
   ```
   These two values are **meant to be public**. ⚠️ **Never** paste the `service_role` or `secret` key. If you do, the website stops itself and shows a warning.

### Step 4: Put the website online (free)
**Easiest option: Netlify drag and drop**
1. Create a free account at **https://app.netlify.com/signup**.
2. Go to **https://app.netlify.com/drop** and drag the **whole `classboard` folder** onto the page.
3. You get an address like `https://cheerful-otter-123.netlify.app`. You can rename it under **Site configuration → Change site name**, for example `ms-huda-english.netlify.app`.
4. To update the site later, open your site → **Deploys** → drag the folder again.

Other free options are just as good:
- **Cloudflare Pages** (Workers & Pages → Create → Pages → Upload assets) has unmetered bandwidth for static files.
- **GitHub Pages** also works. It ignores the `_headers` security file, but the site still works.

### Step 5: Tell Supabase your website address
In Supabase, open **Authentication → URL Configuration**:
- Set **Site URL** to your website address, for example `https://ms-huda-english.netlify.app`.
- Add the same address under **Redirect URLs**.

This makes the email links (confirm account, reset password) come back to your site.

### Step 6: Create your teacher account
Open your website, click **I am a teacher → Create a teacher account**, and confirm the email. You are ready. 🎉

> Other teachers can create their own accounts on the same site. Each teacher only ever sees their own boards and students.

---

## 3. Make your first board
1. Sign in and click **＋ New board**.
2. Type a title, for example *Unit 3 – Animals*, then the class (*4A*), unit and lesson. Choose a layout and a colour theme.
3. Optional: click **🎲 Make one** to create a **class code**.
4. Optional: turn on **Approve posts before others see them**. This is a good idea for the first lessons.
5. Click **Create board**. You are now on the board.
6. Click **＋ Add** and add, for example:
   - 🔤 **Vocabulary card(s)**: open **"⚡ Add many word cards at once"** and paste lines like
     `lion | a big wild cat | The lion is sleeping.`
   - 🗣️ **Speaking prompt**: *Tell us about your favourite animal.*
   - 🎯 **Activity → Vocabulary challenge**: write questions, select the right answers, and click **Save activity**.
7. Click **👀 Student view** to check what students will see, then **Exit student view**.
8. Open **📊 Monitor → 📝 Class list** and paste your students' first names, one per line. This lets the Monitor show who has **not** joined or submitted yet.

---

## 4. Share a board in Microsoft Teams
1. On the board, click **📤 Share**.
2. Click **📋 Copy Teams message**. It contains the board name, the link and the class code.
3. In **Teams**, open your class team, then the channel (or the class chat). Paste the message and click **Send**.
4. Students click the link, type their **first name** (and the class code if you set one), and press **Let's go! 🚀**.
5. Their posts and answers appear on your board and in **📊 Monitor** within a second or two.

**Tips for Teams**
- If **recording does not work** inside Teams, students should choose **"Open in browser"**. Some Teams apps block the microphone in their built-in viewer. Chrome, Edge and Safari all work.
- Students stay signed in on their own device, so next lesson they just click the link again.
- You can also pin the link as a **Website tab** in the channel (**＋** → Website). For recording, the browser is still the most reliable choice.

---

## 5. Teacher cheat sheet
| I want to… | Do this |
|---|---|
| Stop everyone posting for a moment | Click **🔓 Posting open** on the board; it changes to 🔒 *Posting paused* |
| Start or stop a quiz or task | Click **🟢 Open / 🔴 Closed** on its card |
| Show one student's answer to everyone | Use the card's **⋯ → 🖥️ Show to the class**, then **Stop showing** when you are done |
| Approve posts | Click the **⏳ N waiting** button, then use ⋯ → **✅ Approve** on each card. To approve all answers to a task at once, use **📥 answers → ✅ Approve all** |
| Mark work and give feedback | Use **📥 answers** on a task card, or **📊 Monitor → Review & mark**. Type the mark and feedback, then click **💾 Save**. Only that student sees them |
| See who has not answered | Open **📊 Monitor → Tasks** and look at the **Not yet** column |
| Export results to Excel | Open **📊 Monitor → ⬇️ Export** |
| Change the layout | Use the layout menu at the top of the board. Nothing is lost |
| Move cards around | **Canvas**: drag a card by its top bar. Elsewhere: **⋯ → Move earlier / later**, **📌 Pin**, or **Move to column** (Shelf) |
| Connect ideas | In **Canvas**, use **⋯ → 🔗 Connect to…** and then click another card |
| Reuse a board next year | Open the dashboard and use **⋯ → 📄 Duplicate**. Your content is copied but student work is not |
| Remove a student | Open **📊 Monitor → Students → View work → Remove student from board** |
| Turn features on or off | Click **⚙️** on the board. Comments, likes, stars, voting, peer feedback, uploads, audio, editing, names and the leaderboard each have their own switch |

---

## 6. Free-plan limits
At the time of writing (November 2026), the free plans include the amounts below. Check the providers' pricing pages, because these can change.

| Supabase free plan | What it means for you |
|---|---|
| 500 MB database | Text posts are tiny. Thousands of posts use only a few MB. |
| **1 GB file storage**, 50 MB maximum per file | Recordings use about **0.8 MB per minute** (measured in testing), so 1 GB holds roughly **1,200 minutes** of student audio. This app limits uploads to 20 MB per file (10 MB for pictures). Deleting a board also deletes the files students uploaded to it. |
| **5 GB data transfer (egress) per month** | Every time a recording or picture is played or viewed, it counts. One class of 30 using audio every lesson fits comfortably. Prefer **YouTube links over video uploads**. |
| 50,000 monthly active users | Each student device counts as one user. This is far more than you need. |
| 200 live connections at the same time | About 6 full classes at once on live updates. If it is ever exceeded, the board still refreshes every 20 seconds. |
| **Projects pause after 7 days without activity** | ⚠️ After a long holiday, open Supabase and click **Restore project**. Nothing is deleted. To avoid this, open your dashboard once a week. |
| Built-in email sends only a few emails per hour | This only affects teacher sign-up and password-reset emails. |

**Netlify free plan:** 300 credits per month as a hard limit, which is roughly 15 GB of website traffic plus deploys (about 15 credits each). If the credits run out, the site pauses until next month. This app's files are small (about 150 KB), so a class is far below the limit. If you ever hit it, Cloudflare Pages is also free and does not meter static traffic.

---

## 7. Known limitations
These are honest notes about what free services and a simple design can and cannot do.

- **A student's identity is tied to one device and browser.** There are no student passwords. If a student changes device or clears the browser, they join again with the same name and can post again, but they can no longer edit their old posts. The Monitor joins entries with the same name together (shown as "2 devices").
- **Classmates could type each other's names.** Use the class code, keep **approval mode** on when needed, and check the Monitor.
- **Spelling challenge:** the word has to reach the browser so the computer voice can say it. It is never shown on screen, but a very technical user could find it in the browser's developer tools. Answers for all other question types stay on the server. For high-stakes spelling tests, record the words yourself.
- **Text-to-speech voices depend on the device.** Most laptops, tablets and phones have English voices. To set the accent for everyone, record your own voice on vocabulary and reading cards.
- **Recording needs** a reasonably recent browser and an HTTPS address, which Netlify and Cloudflare provide automatically. Teams' built-in viewer sometimes blocks the microphone; use "Open in browser".
- **No automatic bad-word filter.** Use approval mode, Reject, or Delete.
- **Live updates** use Supabase Realtime, with a refresh every 20 seconds as a backup. Updates are near-instant but there is no live typing indicator.
- **Optional hardening:** Supabase recommends adding a CAPTCHA (such as Cloudflare Turnstile) to anonymous sign-ins on public sites. ClassBoard works without one. Raising the anonymous rate limit as described above is the most important setting.

---

## 8. Security and privacy
- **Security rules in the database (Row Level Security)** check every read and write, not just the website buttons. A student who tries to call the database directly still cannot:
  - see other boards, the class code, the class list, answer keys, or other students' marks and feedback
  - edit or delete classmates' work, approve their own posts, create teacher content, or post while posting is paused or the board is archived
- **Teacher accounts** use email and password. Student sessions are anonymous and **cannot** create boards.
- **Files are stored privately.** They open through temporary links that last 1 hour. The server checks every upload's type and size (pictures, audio, video, PDF, Word and PowerPoint only).
- **No secret keys in the website.** `js/config.js` only holds the public key. The website refuses to run if a secret key is pasted there.
- **Only first names** are collected from students; there is no email and no surname.
- **Delete data** by deleting a board. This removes all its posts, answers, marks and uploaded student files.
- Spreadsheet exports guard against formula injection, so a student cannot write a "formula" that runs in Excel.

---

## 9. Troubleshooting
| Problem | Fix |
|---|---|
| "ClassBoard is almost ready" page | `js/config.js` still has the placeholder values. Paste your URL and key, then upload the folder again. |
| Students see "Joining is not switched on yet" | Turn on **Allow anonymous sign-ins** (Step 2). |
| "Too many classmates joined at once" | Raise the **anonymous sign-ins rate limit** (Step 2). |
| The microphone is blocked | Click the 🔒 next to the web address, allow the **Microphone**, and reload. In Teams, use **Open in browser**. |
| The confirmation email never arrives | Check spam. Or turn off **Confirm email** for a moment, sign up, and turn it back on. |
| Everything stopped working after a holiday | The Supabase project paused. Open Supabase and click **Restore project**. |
| Email links open the wrong website | Set **Site URL** and **Redirect URLs** (Step 5). |
| "You are not allowed to do that" | That action is blocked by the rules. For example, posting is paused, the board is archived, or the feature is off in ⚙️. |
| A student was removed by mistake | They can open the link again and re-join. Their earlier posts are still on the board. |

---

## 10. How it was tested
Before delivery, the app was tested end-to-end in Google Chrome. It ran against a **real PostgreSQL 16 database** loaded with `supabase/schema.sql`, so the real security rules, triggers and functions were enforced. A small stand-in replaced Supabase's network layer.

**Database security tests: 58 of 58 passed.** Every role was tested: teacher, two students, another teacher, and an outsider. The tests checked:
- joining, wrong codes, approval, editing, deleting and pausing
- answer keys, marks and private data
- file storage permissions, duplicate and archive

**Browser scenarios: 56 of 56 checks passed.** The suites were run several times. On one run, a test step timed out once and passed on re-running.
- ✅ The teacher creates a board.
- ✅ The teacher shares the board link.
- ✅ Two students open the same board.
- ✅ Both students submit different answers.
- ✅ Both submissions appear on the teacher's board live.
- ✅ The teacher approves a submission.
- ✅ A student records an audio answer, plays it back, re-records and submits it.
- ✅ The teacher plays the recording.
- ✅ Data and student sessions remain after refreshing the page.
- ✅ Students cannot open teacher pages. Direct attempts to change the board, read answer keys, edit or delete a classmate's post, or set marks were all blocked.
- ✅ Also tested: all 7 layouts, server-checked quizzes and the spelling challenge, reading and writing answers, uploads and drawing (including a blocked `.exe` file), comments, likes, stars and votes, "Show to the class", posting pause, canvas drag and connect, CSV export, duplicate, edit and delete board, and no JavaScript errors under the production security headers.

The `tests/` folder contains these test scripts for developers. Teachers do not need it, and it does not have to be uploaded.

---

## 11. Files
```
classboard/
├── index.html              the single page
├── _headers                security headers (Netlify / Cloudflare Pages)
├── css/app.css             all styles (pastel, rounded, responsive)
├── js/config.js            ← your Supabase URL + public key go here
├── js/main.js              page routing
├── js/supa.js              database connection
├── js/ui.js                buttons, dialogs, helpers (safe text only)
├── js/files.js             upload checks, private file links
├── js/media.js             audio recorder, drawing pad, text-to-speech
├── js/views/
│   ├── entry.js            home, teacher sign-in, student join
│   ├── dashboard.js        teacher dashboard
│   ├── boardForm.js        board settings, share dialog
│   ├── board.js            the board, 7 layouts, live controls, live updates
│   ├── postcard.js         post cards, reactions, comments
│   ├── composer.js         posts, English tools, student answers, spelling practice
│   ├── activities.js       activity builder and player
│   ├── review.js           marking and feedback
│   └── monitor.js          participation, class list, CSV export
├── supabase/schema.sql     database, security rules, storage (run once)
└── tests/                  developer tests (optional)
```
