const { createClient } = require("@supabase/supabase-js");

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();

  // GET — fetch current prompt
  if (req.method === "GET") {
    const { password } = req.query;
    if (password !== ADMIN_PASSWORD) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const { data, error } = await supabase
      .from("prompt_config")
      .select("prompt_value, updated_at")
      .eq("prompt_key", "system_prompt")
      .single();

    if (error) return res.status(500).json({ error: "Failed to fetch prompt" });
    return res.status(200).json(data);
  }

  // POST — update prompt
  if (req.method === "POST") {
    const { password, prompt } = req.body;
    if (password !== ADMIN_PASSWORD) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    if (!prompt || prompt.trim().length < 10) {
      return res.status(400).json({ error: "Prompt too short" });
    }

    const { error } = await supabase
      .from("prompt_config")
      .update({ prompt_value: prompt, updated_at: new Date().toISOString() })
      .eq("prompt_key", "system_prompt");

    if (error) return res.status(500).json({ error: "Failed to update prompt" });
    return res.status(200).json({ success: true });
  }

  return res.status(405).end();
};