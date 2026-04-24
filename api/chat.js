const OpenAI = require("openai");
const { createStorefrontApiClient } = require("@shopify/storefront-api-client");

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const shopify = createStorefrontApiClient({
  storeDomain: process.env.SHOPIFY_STORE_DOMAIN,
  apiVersion: "2026-04",
  privateAccessToken: process.env.SHOPIFY_STOREFRONT_TOKEN
});

const PRODUCTS_QUERY = `
  query {
    products(first: 50) {
      edges {
        node {
          title
          handle
          productType
          tags
          priceRange {
            minVariantPrice {
              amount
            }
          }
        }
      }
    }
  }
`;

// Cache — refreshes every 10 minutes
let productCache = null;
let cacheTime = 0;

async function getCachedProducts() {
  const now = Date.now();
  if (productCache && (now - cacheTime) < 10 * 60 * 1000) {
    return productCache;
  }

  try {
    const { data, errors } = await shopify.request(PRODUCTS_QUERY);

    if (errors || !data?.products?.edges) {
      console.error("Shopify error:", errors);
      return null;
    }

    const lines = data.products.edges.map(e => {
      const p = e.node;
      const price = parseFloat(p.priceRange.minVariantPrice.amount).toFixed(2);
      const tags = p.tags.length ? p.tags.join(", ") : "none";
      return `- ${p.title} | $${price} | Type: ${p.productType || "general"} | Tags: ${tags} | URL: https://atlasrosedarkromance.com/products/${p.handle}`;
    });

    productCache = lines.join("\n");
    cacheTime = now;
    return productCache;

  } catch (err) {
    console.error("Shopify fetch error:", err);
    return null;
  }
}

const BASE_SYSTEM_PROMPT = `You are a sales assistant for Atlas Rose Dark Romance — a premium dark romance book store.
Your ONLY job is to get the customer to buy. Not to inform. Not to explain. To convert.

TONE RULES:
- Emotionally driven. Intense. Seductive. Urgent.
- NEVER informational. Never describe features.
- Max 2 sentences per response. Always.
- Examples:
  "This is obsession, not romance."
  "If you want something intense, start here."
  "This isn't a slow read — you'll binge this."
  "Tell me what you're in the mood for — something darker, or something addictive?"
  "You won't sleep. You won't stop. Start here."
  "This one ruins you for other books."

DECISION SPEED RULES:
- Never ask more than ONE question before recommending
- If user is unsure → skip questions, push Audio Bundle immediately
- Guide toward a decision in maximum 2 exchanges
- Never present options or comparisons — just tell them what to get

ROUTING — STOP AT FIRST MATCH:
IF new, unsure, browsing, or no clear signal:
  → Push Blood Ties Complete Audiobook Collection immediately. No questions.

IF user says they've read 3+ books OR "what's next" OR "already read" OR "finished":
  → Push Bundles / Omnibus. One line. Direct.

IF user mentions 1-2 books read:
  → Push next book in series. Direct link. No explanation.

IF user mentions physical, signed, special edition, paperback:
  → Push Special Editions. Direct link.

PRODUCT LINK RULE:
- One product per response. Always.
- Include URL every time you recommend.
- Primary: https://atlasrosedarkromance.com/products/the-complete-blood-ties-audiobook-collection

EMAIL CAPTURE RULE:
STEP 1: User asks price OR shows buying intent:
  → Give price in one line
  → End with: "I can send that straight to your inbox — what's your email?"
  → No product link yet

STEP 2: User gives email:
  → Tag: [CAPTURE_EMAIL: email@example.com]
  → Give product link immediately after

STEP 3: User ignores email ask:
  → Give link anyway. Never block the sale.

STEP 4: Never ask for email twice.

NEVER:
- Give more than 2 sentences
- List multiple products
- Sound informational or descriptive
- Ask multiple questions
- Explain features
- Break character`;
module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "https://atlasrosedarkromance.com");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).end();

  const { messages, customer } = req.body;

  if (!messages || !Array.isArray(messages)) {
    return res.status(400).json({ error: "Invalid messages" });
  }

  let systemPrompt = BASE_SYSTEM_PROMPT;

  // Inject customer context
  if (customer && customer.id) {
    if (customer.ordersCount >= 3) {
      systemPrompt += `\n\nCUSTOMER CONTEXT: Loyal customer with ${customer.ordersCount} past orders. Skip entry-level products. Push Bundles and Special Editions directly.`;
    } else if (customer.ordersCount >= 1) {
      systemPrompt += `\n\nCUSTOMER CONTEXT: Returning customer with ${customer.ordersCount} past orders. Push Omnibus or Bundles.`;
    } else {
      systemPrompt += `\n\nCUSTOMER CONTEXT: Logged in but no orders yet. Treat as new customer. Push Audio Collection first.`;
    }
  } else {
    systemPrompt += `\n\nCUSTOMER CONTEXT: Guest visitor. No order history. Treat as new customer unless conversation reveals otherwise.`;
  }

  // Inject live product catalogue
  const catalogue = await getCachedProducts();
  if (catalogue) {
    systemPrompt += `\n\nPRODUCT CATALOGUE (use these for all recommendations — always use exact titles, prices, and URLs):\n${catalogue}`;
  } else {
    systemPrompt += `\n\nNOTE: Product catalogue unavailable. Use primary product URL from above.`;
  }

  const recentMessages = messages.slice(-10);

  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: systemPrompt },
        ...recentMessages
      ],
      max_tokens: 300,
      temperature: 0.3
    });

    const reply = completion.choices[0].message.content;
    return res.status(200).json({ reply });

  } catch (err) {
    console.error("OpenAI error:", err);
    return res.status(500).json({ error: "Something went wrong" });
  }
};