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

## Before going live

- **Keep booked days up to date.** Each service's fully booked days are listed in `BOOKED` in `script.js`; they are not synced with Google Calendar.
- **Connect the booking form.** Right now requests are validated and confirmed on screen, and saved only in the visitor's browser (`localStorage` key `yw-requests`). Nothing reaches the business yet. Wire the submit handler in `script.js` to email, LINE, a form service (e.g. Formspree), or a backend/CRM.
- **Add contact details** (phone, LINE ID, email, address, opening hours) to the footer and booking section.
- **Confirm the service area** and any pricing you want to publish (the FAQ currently says prices are quoted per request).
- Optional: add a Thai-language version and real photography.
