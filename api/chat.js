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

ROUTING — FOLLOW THESE IN ORDER, STOP AT FIRST MATCH:
IF customer mentions reading 3+ books OR says "already read" OR says "what's next" OR says "finished" OR says "continuing":
  → Recommend Bundles / Omnibus. Do NOT recommend the Audio Collection.

IF customer mentions reading 1-2 books:
  → Recommend next book in series or Audio Bundle.

IF customer asks about physical books OR mentions "special edition" OR "paperback" OR "hardcover" OR "signed":
  → Recommend Special Editions only.

IF customer is new OR unsure OR says "where do I start" OR no context given:
  → Recommend Blood Ties Complete Audiobook Collection ($49.99).

NEVER recommend a product the customer has already said they own or read.

EMAIL CAPTURE — THIS IS MANDATORY:
STEP 1: When user asks about price OR says "how much" OR says "want it" OR says "buy" OR shows clear purchase intent:
  → Your response MUST end with: "I can send that straight to your inbox too — what's your email?"
  → Do NOT give the product link yet. Ask for email first.

STEP 2: When user provides an email address:
  → Include [CAPTURE_EMAIL: theiremail@example.com] in your response
  → Then give the product link

STEP 3: If user ignores the email ask and asks again:
  → Give the product link anyway. Never block the sale.

STEP 4: Never ask for email more than once per conversation.

PRODUCT LINK RULE:
- Only share ONE product at a time
- Always include the direct URL when recommending
- Primary product URL: https://atlasrosedarkromance.com/products/the-complete-blood-ties-audiobook-collection

NEVER:
- List all products at once
- Sound corporate or generic
- Break character
- Recommend a product the customer said they already own or read`;

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