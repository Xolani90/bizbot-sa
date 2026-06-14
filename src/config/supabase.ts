import { createClient } from '@supabase/supabase-js';
import { env } from './env';

// Service-role client — used server-side only, bypasses RLS. Never expose
// this key to a client/browser context.
export const supabase = createClient(env.supabaseUrl, env.supabaseServiceRoleKey, {
  auth: { persistSession: false },
});
