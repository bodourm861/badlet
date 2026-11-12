import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import { SUPABASE_URL, SUPABASE_KEY } from './config.js';

export const configured =
  /^https:\/\/.+/.test(SUPABASE_URL) && !SUPABASE_URL.includes('YOUR-PROJECT') &&
  SUPABASE_KEY && !SUPABASE_KEY.startsWith('YOUR-');

if (configured && /service_role|sb_secret_/.test(SUPABASE_KEY + atobSafe(SUPABASE_KEY))) {
  document.body.textContent = 'Security stop: a secret/service_role key was pasted into js/config.js. Use the anon or publishable key instead.';
  throw new Error('Secret key in frontend');
}
function atobSafe(k) { try { return atob(k.split('.')[1] || ''); } catch { return ''; } }

export const sb = configured
  ? createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } })
  : null;

export const BUCKET = 'classroom';

export async function currentUser() {
  const { data } = await sb.auth.getSession();
  return data.session ? data.session.user : null;
}

export function isTeacherUser(user) { return !!user && !user.is_anonymous; }

// Throws on error, returns data.
export async function q(promise) {
  const { data, error } = await promise;
  if (error) throw error;
  return data;
}
