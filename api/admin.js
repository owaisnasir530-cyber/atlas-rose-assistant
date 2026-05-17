const { createClient } = require("@supabase/supabase-js");

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();

  // Debug — check env vars
  const debug = {
    hasSupabaseUrl: !!process.env.SUPABASE_URL,
    hasSupabaseKey: !!process.env.SUPABASE_ANON_KEY,
    hasAdminPassword: !!process.env.ADMIN_PASSWORD,
    passwordMatch: req.query.password === process.env.ADMIN_PASSWORD
  };

  try {
    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_ANON_KEY
    );

    const { data, error } = await supabase
      .from("prompt_config")
      .select("prompt_value, updated_at")
      .eq("prompt_key", "system_prompt")
      .single();

    return res.status(200).json({ debug, data, error });

  } catch (err) {
    return res.status(200).json({ debug, crash: err.message });
  }
};