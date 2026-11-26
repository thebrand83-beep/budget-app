// Public client configuration. The anon key is safe to ship: every table and the
// receipts bucket are protected by Row Level Security. NEVER put a service key here.
// Leave supabaseUrl empty to run in local preview mode (data stays in this browser only).
export const CONFIG = {
  supabaseUrl: 'https://aqsdvzesnqtmnlkyrkeo.supabase.co',
  supabaseAnonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFxc2R2emVzbnF0bW5sa3lya2VvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTE2NDgwNzcsImV4cCI6MjEwNzIyNDA3N30.iCIYiRmwS0VNI9jazNSuA_uQwRcXC8IYwzRf4lxiUXw',
  receiptsBucket: 'budget-receipts',
  ownerEmail: 'studioimage1983@gmail.com',
  supabaseJs: 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.js',
  gemini: {
    apiBase: 'https://generativelanguage.googleapis.com/v1beta',
    // Free-tier models, same chain as the YouTube optimizer. First working one wins.
    models: ['gemini-3-flash-preview', 'gemini-3.5-flash', 'gemini-3.6-flash'],
    timeoutMs: 60000,
  },
  // Osek patur annual turnover ceiling (editable in Settings).
  turnover: {
    ceiling2026: 122833,
    sourceLabel: 'רשות המסים – "סכומים ושיעורים במע"מ" (בתוקף מ-1.1.2026), דרך כל-זכות',
    sourceUrl: 'https://www.kolzchut.org.il/he/%D7%A2%D7%95%D7%A1%D7%A7_%D7%A4%D7%98%D7%95%D7%A8',
  },
  receiptMaxSide: 2400,      // px; phone photos are downscaled to keep them sharp but light
  receiptJpegQuality: 0.88,
  signedUrlSeconds: 600,
};
