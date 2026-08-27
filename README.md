# Shri Vegetables

A fast full-stack fresh-produce storefront with 15 photograph-matched products, Gemini-assisted basket planning, inventory-aware ordering, device alerts and an admin catalogue panel.

## Run locally

1. Copy .env.example to .env and use secure admin credentials.
2. Run npm install.
3. Run npm run dev.

For a production-like run, use npm run build and then npm start.

## Gemini shopping helper

Add GEMINI_API_KEY on the server or in Render. The default model is gemini-2.5-flash. The API key stays server-side. AI runs only after the customer taps the AI button, recommends only live in-stock catalogue IDs and returns structured data. The customer must approve the list, review checkout and explicitly confirm the order.

## Orders and storage

Prices, product availability and quantities are revalidated on the server. For Render, connect a PostgreSQL database and set DATABASE_URL so orders, stock and push subscriptions survive deployments. Without it, the app uses data/store.json, which is useful locally but is not durable on Render's default filesystem.

## Admin and order alerts

Open /?page=admin and sign in with ADMIN_EMAIL and ADMIN_PASSWORD. The panel refreshes orders automatically every 12 seconds.

For background notifications on Android, iOS Home Screen web apps and computers:

1. Create keys with npx web-push generate-vapid-keys.
2. Add VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY and VAPID_SUBJECT to Render.
3. Open Admin on each device and tap **Enable device alerts**.

Optional WhatsApp Business alerts use the WHATSAPP_* variables in .env.example. Orders remain confirmed even when an external notification provider is temporarily unavailable.

## Install on phone

This is an installable Progressive Web App. After HTTPS deployment, use the browser's **Install app** or **Add to Home Screen** action. It works like a lightweight app without maintaining a separate APK.

## Images and performance

The 15 live catalogue entries in server/seed.js use correctly named WebP files from public/products/vegetables. Product images load lazily. Source photographs are recoverably kept in image-originals; npm run optimize:images can rebuild optimized copies.
