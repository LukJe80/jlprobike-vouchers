// supabaseClient.js  (CZYSTY JS — bez <script>)

const SUPABASE_URL = "https://tasibcdejcdpwrnsztkv.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRhc2liY2RlamNkcHdybnN6dGt2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzA0MDMwMjIsImV4cCI6MjA4NTk3OTAyMn0.p_r7ZqdqtRK0xjrAhJH5PnWILg1Edew9BREDavYrgTA";

window.supabaseClient = supabase.createClient(
  SUPABASE_URL,
  SUPABASE_ANON_KEY
);




