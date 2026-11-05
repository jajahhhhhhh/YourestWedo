# YourestWedo

**YourestWedo Co.,Ltd.** is a premium service. We offer a full range of services to help you relax and unwind: cleaning, chauffeur services, car washing at your home, and grocery shopping and delivery, all without you having to leave your house and face the hot sun, bad weather, traffic, or long distances.

We're **CHOWREST**: we serve you so you feel rested, at peace and comfortable.

## Website

This repository holds the company's website, a static, dependency-free site in `public/`:

| File | Purpose |
| --- | --- |
| `public/index.html` | Main Chowrest page: hero, services, how it works, availability, why us, booking form, FAQ |
| `public/cleaning.html`, `chauffeur.html`, `carwash.html`, `grocery.html` | One page per service: details, that service's availability calendar, and a booking form with the service preselected |
| `public/styles.css` | Styling (responsive, mobile-first breakpoints) |
| `public/script.js` | Mobile menu, per-service availability calendars, booking form validation & confirmation |
| `worker.js`, `wrangler.jsonc` | Cloudflare Worker that serves `public/` and gives each service its own subdomain |

### Run locally

Open `public/index.html` in a browser, or serve the folder:

```bash
python3 -m http.server 8000 --directory public
```

Then visit http://localhost:8000.

### Service subdomains

Each service has its own subdomain of `chowrest-property.com`:

| Address | Page |
| --- | --- |
| `services.chowrest-property.com` | `index.html` (YourestWedo main page) |
| `cleaning.chowrest-property.com` | `cleaning.html` |
| `chauffeur.chowrest-property.com` | `chauffeur.html` |
| `carwash.chowrest-property.com` | `carwash.html` |
| `grocery.chowrest-property.com` | `grocery.html` |

The bare `chowrest-property.com` is the separate Chowrest property site and is not served by this Worker; don't add it as a custom domain here.

On a service subdomain, links to another service go to that service's subdomain, and links to the main page go to `services.chowrest-property.com`.

### Deploy on Cloudflare Workers

The site deploys as the `yourestwedo` Worker (`wrangler.jsonc`). Every push to `main` runs `.github/workflows/deploy.yml`, which runs `wrangler deploy` using the `CLOUDFLARE_API_TOKEN` repository secret. It can also be started by hand from the Actions tab.

After the first successful deploy, open the Worker → **Settings** → **Domains & Routes** → **Add** → **Custom domain**, and add each of the five addresses above. Cloudflare creates the DNS records itself.

To test the routing locally:

```bash
npx wrangler dev
```

### Booking requests on LINE

When a customer sends the booking form, the Worker (`POST /api/booking`) checks the request and sends it as a LINE message through the LINE Messaging API. The message includes the services, date and time, contact details, address, and a Google Maps link. Bots that fill a hidden form field are ignored.

For cleaning, the form also asks for the property type, bedrooms, bathrooms and usable area. It shows a rough estimate from the price table, and accepts up to 4 photos. Photos are shrunk in the browser (max 1600 px, under about 900 KB). The Worker stores them for 30 days in the `PhotoStore` Durable Object, which is created automatically on deploy. They are served from `/api/photo/<random id>.jpg` and sent to LINE as image messages after the text.

One-time setup:

1. In the [LINE Developers console](https://developers.line.biz/console/), create a provider and a **Messaging API** channel (this creates a LINE Official Account).
2. In the channel's **Messaging API** tab, issue a **Channel access token (long-lived)**.
3. In the **Basic settings** tab, copy **Your user ID** (starts with `U`).
4. Add the Official Account as a friend in LINE (scan the QR code in the Messaging API tab), or it can't message you.
5. In Cloudflare → Workers & Pages → yourestwedo → **Settings** → **Variables and Secrets**, add two secrets:
   - `LINE_CHANNEL_ACCESS_TOKEN`: the token from step 2
   - `LINE_TO`: the user ID from step 3. To notify several people, separate their IDs with commas. Each person must have added the Official Account as a friend.

**Send bookings to a LINE group** (for example, the manager and staff):

1. In LINE Official Account Manager → **Settings** → **Account settings**, turn on **Allow account to join groups and multi-person chats**. Under **Response settings**, turn off auto-reply messages so the bot stays quiet in the group.
2. In the LINE Developers console → **Basic settings**, copy the **Channel secret** and add it as a third Cloudflare secret, `LINE_CHANNEL_SECRET`.
3. In the channel's **Messaging API** tab, set **Webhook URL** to `https://services.chowrest-property.com/api/line-webhook`, press **Verify**, and turn on **Use webhook**.
4. Add the Official Account to the LINE group. It replies with the group's ID (starts with `C`). If it's already in the group, type `id` in the group.
5. Set `LINE_TO` to that group ID. To also keep getting bookings in a personal chat, add your user ID after a comma, e.g. `C123…,U456…`.

Typing `id` in a one-to-one chat with the Official Account replies with that person's user ID. Each ID in `LINE_TO` gets its own message, and a booking counts as sent if at least one of them receives it.

Secrets stay in Cloudflare across deploys. Until both are set, the form shows "we couldn't send your request".

## Before going live

- **Keep booked days up to date.** Each service's fully booked days are listed in `BOOKED` in `script.js`; they are not synced with Google Calendar.
- **Set the LINE secrets** (see "Booking requests on LINE") so booking requests reach the team.
- **Add contact details** (phone, LINE ID, email, address, opening hours) to the footer and booking section.
- **Confirm the service area** and any pricing you want to publish (the FAQ currently says prices are quoted per request).
- Optional: add a Thai-language version and real photography.
