// Fill these in with your Supabase project's values
// (Project Settings -> API in your Supabase dashboard)
const SUPABASE_URL = 'https://vbdbgqcufibzhrucdhfg.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_MTeu6MK8m2y9u53sPx-hxQ_rNIoXDg3';

// Google OAuth "Web application" Client ID (Google Cloud Console -> APIs & Services -> Credentials).
// Add your site's URL(s) under "Authorized JavaScript origins" for this client.
// This must also be added in Supabase: Authentication -> Providers -> Google -> Client ID.
const GOOGLE_CLIENT_ID = 'YOUR_GOOGLE_CLIENT_ID.apps.googleusercontent.com';

const { createClient } = supabase;
const supabaseClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
