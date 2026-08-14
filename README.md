# Shri Vegetables

A full-stack vegetable storefront with 120 starter products, inventory-aware ordering and an admin catalogue panel.

## Run locally

1. Copy `.env.example` to `.env` and choose secure admin credentials.
2. Run `npm install`.
3. Run `npm run dev`, then open the local Vite address.

For a production-like run: `npm run build` then `npm start`.

## Mobile app download

Shri Vegetables is an installable Progressive Web App. After you deploy it with HTTPS (Render includes HTTPS), visitors can tap **Download App** on the website. On Android Chrome, choose **Install app**; on iPhone Safari, choose **Share → Add to Home Screen**. It opens as a full-screen app and keeps recently visited pages available offline.

## Admin

Open **Admin** in the site header and log in with `ADMIN_EMAIL` and `ADMIN_PASSWORD`. The initial catalog is generated from the central source in `server/seed.js`. Once the application runs, additions, orders and stock updates are stored in `data/store.json`.

## Render deployment

Push this folder to a new GitHub repository. In Render, create a Blueprint from that repository (the included `render.yaml` supplies the commands), or create a Web Service with build command `npm install && npm run build` and start command `npm start`. Set `ADMIN_PASSWORD` to a strong value in Render's environment settings.

Note: the included JSON store is suitable for a demo or small single-instance deployment. For production persistence across deployments and multiple Render instances, replace it with a managed database such as Render Postgres.

## Automatic WhatsApp order alerts

The store can message your WhatsApp Business number every time an order is confirmed. In Meta's WhatsApp Manager, create and approve a utility template named `order_alert` with five body fields in this exact order: order number, customer name, customer phone number, delivery address and order total. Then add the `WHATSAPP_*` values from `.env.example` to your local `.env` or to Render's environment settings. The phone number must include its country code, with no `+` sign. You can list multiple owner numbers separated by commas.

Orders always complete even if WhatsApp is temporarily unavailable, so customers are not blocked by a notification problem.

### No WhatsApp API yet?

The dashboard still saves every order with the customer name, phone number, delivery address, items and total. It gives you an **Open WhatsApp** link with that message pre-filled for your owner number, so you can review and send it with one tap. Fully automatic WhatsApp delivery requires a WhatsApp Business Cloud API account and its access token.
