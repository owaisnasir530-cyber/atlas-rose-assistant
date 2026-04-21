const { createStorefrontApiClient } = require('@shopify/storefront-api-client');

const client = createStorefrontApiClient({
  storeDomain: process.env.SHOPIFY_STORE_DOMAIN,
  apiVersion: '2026-04',
  privateAccessToken: process.env.SHOPIFY_STOREFRONT_TOKEN
});

const productsQuery = `
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

module.exports = async (req, res) => {
  try {
    const { data, errors } = await client.request(productsQuery);

    if (errors) {
      return res.status(500).json({ error: errors });
    }

    const products = data.products.edges.map(e => {
      const p = e.node;
      return {
        title: p.title,
        price: `$${parseFloat(p.priceRange.minVariantPrice.amount).toFixed(2)}`,
        type: p.productType,
        tags: p.tags,
        url: `https://atlasrosedarkromance.com/products/${p.handle}`
      };
    });

    return res.status(200).json({ total: products.length, products });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};