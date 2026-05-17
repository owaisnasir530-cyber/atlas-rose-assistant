const OpenAI = require("openai");
const { createStorefrontApiClient } = require("@shopify/storefront-api-client");
const { createClient } = require("@supabase/supabase-js");

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const shopify = createStorefrontApiClient({
  storeDomain: process.env.SHOPIFY_STORE_DOMAIN,
  apiVersion: "2026-04",
  privateAccessToken: process.env.SHOPIFY_STOREFRONT_TOKEN
});

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

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

// Product cache — refreshes every 10 minutes
let productCache = null;
let productCacheTime = 0;

// Prompt cache — refreshes every 2 minutes
let promptCache = null;
let promptCacheTime = 0;

async function getCachedProducts() {
  const now = Date.now();
  if (productCache && (now - productCacheTime) < 10 * 60 * 1000) {
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
    productCacheTime = now;
    return productCache;

  } catch (err) {
    console.error("Shopify fetch error:", err);
    return null;
  }
}

async function getCachedPrompt() {
  const now = Date.now();
  if (promptCache && (now - promptCacheTime) < 2 * 60 * 1000) {
    return promptCache;
  }

  try {
    const { data, error } = await supabase
      .from("prompt_config")
      .select("prompt_value")
      .eq("prompt_key", "system_prompt")
      .single();

    if (error || !data) {
      console.error("Supabase error:", error);
      return null;
    }

    promptCache = data.prompt_value;
    promptCacheTime = now;
    return promptCache;

  } catch (err) {
    console.error("Prompt fetch error:", err);
    return null;
  }
}

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

  // Fetch prompt from Supabase
  let systemPrompt = await getCachedPrompt();

  if (!systemPrompt) {
    return res.status(500).json({ error: "Could not load prompt configuration" });
  }

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
      max_tokens: 200,
      temperature: 0.7
    });

    const reply = completion.choices[0].message.content;
    return res.status(200).json({ reply });

  } catch (err) {
    console.error("OpenAI error:", err);
    return res.status(500).json({ error: "Something went wrong" });
  }
};