const { createClient } = require("@supabase/supabase-js");

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();

  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_ANON_KEY
  );

  // GET — fetch current prompt
  if (req.method === "GET") {
    const { password } = req.query;

    if (!password || password !== ADMIN_PASSWORD) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    try {
      const { data, error } = await supabase
        .from("prompt_config")
        .select("prompt_value, updated_at")
        .eq("prompt_key", "system_prompt")
        .single();

      if (error || !data) {
        return res.status(500).json({ error: "Failed to fetch prompt" });
      }

      return res.status(200).json({
        prompt_value: data.prompt_value,
        updated_at: data.updated_at
      });

    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  // POST — update prompt
  if (req.method === "POST") {
    const { password, prompt } = req.body;

    if (!password || password !== ADMIN_PASSWORD) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    if (!prompt || prompt.trim().length < 10) {
      return res.status(400).json({ error: "Prompt too short" });
    }

    try {
      const { error } = await supabase
        .from("prompt_config")
        .update({
          prompt_value: prompt.trim(),
          updated_at: new Date().toISOString()
        })
        .eq("prompt_key", "system_prompt");

      if (error) {
        return res.status(500).json({ error: "Failed to update prompt" });
      }

      return res.status(200).json({ success: true });

    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  return res.status(405).end();
};