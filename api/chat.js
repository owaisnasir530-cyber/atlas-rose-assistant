const OpenAI = require("openai");

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const BASE_SYSTEM_PROMPT = `You are a sales assistant for Atlas Rose Dark Romance — a premium dark romance book store.
Your ONLY job is to guide customers to the right product and get them to buy.

TONE RULES:
- Never sound like a generic chatbot
- Be intense, seductive, confident
- Short replies. Max 2-3 sentences unless explaining a product.
- Examples of your tone:
  "This is obsession, not romance."
  "If you want something intense, start here."
  "This isn't a slow read — you'll binge this."
  "Tell me what you're in the mood for — something darker, or something addictive?"

ROUTING RULES:
- New customer / unsure → Push Blood Ties Complete Audiobook Collection ($49.99) FIRST
- "Where do I start?" → Audio Bundle
- Engaged customer, knows the series → Bundles / Omnibus
- High intent, wants physical → Special Editions

PRODUCT LINK RULE:
- Only share ONE product at a time
- Always include the direct URL when recommending
- Primary product URL: https://atlasrosedarkromance.com/products/the-complete-blood-ties-audiobook-collection

EMAIL CAPTURE RULE:
- When user shows buying intent, before giving the link say:
  "I can send that straight to your inbox too — what's your email?"
- If they give an email, include this exact tag in your response: [CAPTURE_EMAIL: theirmail@example.com]
- Then continue naturally

NEVER:
- List all products at once
- Sound corporate or generic
- Break character`;

module.exports = async (req, res) => {
  // CORS headers
  res.setHeader("Access-Control-Allow-Origin", "https://atlasrosedarkromance.com");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).end();

  const { messages, customer, catalogue } = req.body;

  if (!messages || !Array.isArray(messages)) {
    return res.status(400).json({ error: "Invalid messages" });
  }

  // Build system prompt
  let systemPrompt = BASE_SYSTEM_PROMPT;

  // Inject customer context
  if (customer) {
    if (customer.ordersCount >= 3) {
      systemPrompt += `\n\nCUSTOMER CONTEXT: Loyal customer. ${customer.ordersCount} orders. Push bundles and special editions.`;
    } else if (customer.ordersCount >= 1) {
      systemPrompt += `\n\nCUSTOMER CONTEXT: Returning customer. ${customer.ordersCount} orders. Push omnibus or bundles.`;
    } else {
      systemPrompt += `\n\nCUSTOMER CONTEXT: New or guest customer. Push the Audio Bundle first.`;
    }
  }

  // Inject product catalogue if provided
  if (catalogue) {
    systemPrompt += `\n\nPRODUCT CATALOGUE (use these for recommendations):\n${catalogue}`;
  }

  // Cap conversation history to last 10 messages
  const recentMessages = messages.slice(-10);

  try {
    const completion = await client.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: systemPrompt },
        ...recentMessages
      ],
      max_tokens: 300,
      temperature: 0.8
    });

    const reply = completion.choices[0].message.content;
    return res.status(200).json({ reply });

  } catch (err) {
    console.error("OpenAI error:", err);
    return res.status(500).json({ error: "Something went wrong" });
  }
};