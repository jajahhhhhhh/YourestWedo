# YourestWedo

**YourestWedo Co.,Ltd.** is a premium service. We offer a full range of services to help you relax and unwind: cleaning, chauffeur services, car washing at your home, and grocery shopping and delivery, all without you having to leave your house and face the hot sun, bad weather, traffic, or long distances.

We're **CHOWREST**: we serve you so you feel rested, at peace and comfortable.

## Website

This repository holds the company's marketing website, a static, dependency-free site:

| File | Purpose |
| --- | --- |
| `index.html` | Single-page site: hero, services, how it works, why us, booking form, FAQ |
| `styles.css` | Styling (responsive, mobile-first breakpoints) |
| `script.js` | Mobile menu, service preselection, booking form validation & confirmation |

### Run locally

Open `index.html` in a browser, or serve the folder:

```bash
python3 -m http.server 8000
```

Then visit http://localhost:8000.

### Deploy

Any static host works (GitHub Pages, Vercel, Netlify, Cloudflare Pages). There is no build step.

## Before going live

- **Connect the booking form.** Right now requests are validated and confirmed on screen, and saved only in the visitor's browser (`localStorage` key `yw-requests`). Nothing reaches the business yet. Wire the submit handler in `script.js` to email, LINE, a form service (e.g. Formspree), or a backend/CRM.
- **Add contact details** (phone, LINE ID, email, address, opening hours) to the footer and booking section.
- **Confirm the service area** and any pricing you want to publish (the FAQ currently says prices are quoted per request).
- Optional: add a Thai-language version and real photography.
