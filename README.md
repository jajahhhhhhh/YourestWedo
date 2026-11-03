# YourestWedo

**YourestWedo Co.,Ltd.** is a premium service. We offer a full range of services to help you relax and unwind: cleaning, chauffeur services, car washing at your home, and grocery shopping and delivery, all without you having to leave your house and face the hot sun, bad weather, traffic, or long distances.

We're **CHOWREST**: we serve you so you feel rested, at peace and comfortable.

## Website

This repository holds the company's marketing website, a static, dependency-free site:

| File | Purpose |
| --- | --- |
| `index.html` | Single-page site: hero, services, how it works, why us, booking form, FAQ |
| `styles.css` | Styling (responsive, mobile-first breakpoints) |
| `cleaning.html`, `chauffeur.html`, `carwash.html`, `grocery.html` | One page per service: details, that service's availability calendar, and a booking form with the service preselected |
| `script.js` | Mobile menu, per-service availability calendars, booking form validation & confirmation |
| `functions/_middleware.js` | Cloudflare Pages: serves each service page on its own subdomain (see below) |
| `vercel.json` | The same subdomain routing, for Vercel |

### Run locally

Open `index.html` in a browser, or serve the folder:

```bash
python3 -m http.server 8000
```

Then visit http://localhost:8000.

### Deploy

Any static host works (GitHub Pages, Vercel, Netlify, Cloudflare Pages). There is no build step.

### Service subdomains

Each service has its own subdomain of `chowrest-property.com` (the domain is on Cloudflare):

| Address | Page |
| --- | --- |
| `chowrest-property.com` | `index.html` (main Chowrest page) |
| `cleaning.chowrest-property.com` | `cleaning.html` |
| `chauffeur.chowrest-property.com` | `chauffeur.html` |
| `carwash.chowrest-property.com` | `carwash.html` |
| `grocery.chowrest-property.com` | `grocery.html` |

On a service subdomain, links to another service go to that service's subdomain, and links to the main page go to `chowrest-property.com`.

**Cloudflare Pages (recommended, the domain is already on Cloudflare).** Routing is handled by `functions/_middleware.js`.

1. Cloudflare dashboard → **Workers & Pages** → **Create** → **Pages** → **Connect to Git** → choose `jajahhhhhhh/YourestWedo`.
2. Framework preset: **None**. Build command: leave empty. Build output directory: `/`. Production branch: `main`.
3. After the first deploy, open the project → **Custom domains** and add `chowrest-property.com`, `cleaning.chowrest-property.com`, `chauffeur.chowrest-property.com`, `carwash.chowrest-property.com` and `grocery.chowrest-property.com`. Cloudflare creates the DNS records automatically.

**Vercel (alternative).** `vercel.json` does the same routing. Add the five addresses under Project → Settings → Domains and create the DNS records Vercel shows in Cloudflare (set them to "DNS only", grey cloud).

## Before going live

- **Keep booked days up to date.** Each service's fully booked days are listed in `BOOKED` in `script.js`; they are not synced with Google Calendar.
- **Connect the booking form.** Right now requests are validated and confirmed on screen, and saved only in the visitor's browser (`localStorage` key `yw-requests`). Nothing reaches the business yet. Wire the submit handler in `script.js` to email, LINE, a form service (e.g. Formspree), or a backend/CRM.
- **Add contact details** (phone, LINE ID, email, address, opening hours) to the footer and booking section.
- **Confirm the service area** and any pricing you want to publish (the FAQ currently says prices are quoted per request).
- Optional: add a Thai-language version and real photography.
