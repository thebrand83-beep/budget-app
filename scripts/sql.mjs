// Run SQL on a project via the Management API: node scripts/sql.mjs <ref> "<sql>"  (token from env, never printed)
const [ref, q] = process.argv.slice(2);
const r = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, { method: 'POST', headers: { Authorization: 'Bearer ' + process.env.SUPABASE_ACCESS_TOKEN, 'Content-Type': 'application/json' }, body: JSON.stringify({ query: q }) });
console.log(r.status, JSON.stringify(await r.json()));
