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

#### Seeing this project's costs on their own

Cloudflare bills per **account**, not per API token or per Worker. To see exactly what YourestWedo costs, run it in a Cloudflare account that holds nothing else, and deploy with a token that can only reach that account.

1. **Create a Cloudflare account just for YourestWedo**, add a payment method, and copy its **Account ID** (the 32-character code in the dashboard address, right after `dash.cloudflare.com/`).
2. **Create a deploy token there.** My Profile → API Tokens → Create Token → **Edit Cloudflare Workers** template. Under **Account Resources**, include only the new account. If the custom domains will live in that account, add the zone under **Zone Resources** as well.
3. **Point GitHub at it.** Repo → Settings → Secrets and variables → Actions:
   - Secrets: replace `CLOUDFLARE_API_TOKEN` with the new token.
   - Variables: add `CLOUDFLARE_ACCOUNT_ID` with the new account's ID. Without it, deploys go to the original account.
4. **Re-add the Worker's settings** in the new account (Workers & Pages → yourestwedo → Settings → Variables and Secrets): `LINE_CHANNEL_ACCESS_TOKEN`, `LINE_CHANNEL_SECRET`, `LINE_TO` and the other group IDs, `PROMPTPAY_ID`, `PROMPTPAY_NAME`, `EASYSLIP_KEY`, `SHEET_URL`, `SHEET_SECRET` and any others you set. They are not copied between accounts.
5. **Move the domain.** A Worker's custom domains must be in the same account, so move the `chowrest-property.com` zone to the new account, then add the five custom domains to the new Worker. The zone's other DNS records, including the Chowrest property site's, move with it unchanged.
6. **Check the LINE webhook URL** in the LINE Developers console still points at the new deployment.

Durable Object data (open jobs and stored photos) stays in the old account; it is not moved. Switch over when no jobs are open, or finish them first. After the switch, the new account's **Billing** page shows only this project's costs, and Workers & Pages → yourestwedo → **Metrics** shows its requests and Durable Object usage.

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

Add each value with type **Secret** (Encrypt), not Text. `keep_vars` in `wrangler.jsonc` also stops deploys from clearing Text variables, but Secrets keep the token hidden in the dashboard. Until both are set, the form shows "we couldn't send your request".

### Payments (PromptPay)

The team asks for payment after the admin confirms the price.

1. In Cloudflare (Workers & Pages → yourestwedo → Settings → Variables and Secrets) add:
   - `PROMPTPAY_ID`: the company's PromptPay mobile number, 13-digit tax ID, or the 15-digit e-wallet ID shown under a bank app's receive QR (e.g. K PLUS `เลขที่อ้างอิง`).
   - `PROMPTPAY_NAME`: the account name customers should see, e.g. `YourestWedo Co.,Ltd.`
2. In the LINE group (or any chat in `LINE_TO`), type `pay <amount> <what it's for>`, e.g. `pay 1500 Cleaning 19 Nov, Khun Somchai`. Thai also works: `จ่าย 1500 …`.
3. The bot replies with a payment link and a reference code. Send the link to the customer.
4. The customer's page shows a PromptPay QR for exactly that amount. They pay in their bank app and upload the slip.
5. The slip arrives in the admin group with the amount, reference, job and two buttons: **✅ เงินเข้าแล้ว** (money received) and **❌ ไม่พบยอด** (not found). Check the bank app, then tap one; the job and the sheet record who confirmed and when. The page reads the QR printed on the slip, so a slip that was already used for another payment is flagged. 

   **Automatic slip check (EasySlip).** Sign up at easyslip.com, create an API key, and add it in Cloudflare as the Secret `EASYSLIP_KEY`. Each slip is then checked with the bank: the amount must equal the payment link, the slip must not have been used before, and the receiver name must contain the first name in `PROMPTPAY_NAME` (or set `SLIP_RECEIVER_NAME`; or register the account in EasySlip and set `EASYSLIP_MATCH_ACCOUNT` = `1`). A matching slip is confirmed automatically; a wrong one is rejected on the page, so the customer can send the right slip, and the admin group is told why. If EasySlip can't answer (for example a Bangkok Bank transfer under 5 minutes old) the ✅/❌ buttons are used as before.

Links are signed with `LINE_CHANNEL_SECRET`, so the amount can't be changed in the address bar. Card payments through a payment gateway (Stripe or Opn/Omise) can be added once the merchant account is approved.

### Jobs: dispatch and records (LINE groups + Google Sheet)

Three LINE groups, each with the bot in it:

| Group | Cloudflare variable | Gets |
| --- | --- | --- |
| Admin | `LINE_TO` | bookings, job cards, payment links and slips, "assigned" / "done" / "problem" alerts |
| Maids | `LINE_TEAM_MAIDS` | cleaning jobs |
| Drivers | `LINE_TEAM_DRIVERS` | chauffeur & errands, grocery and car wash jobs |

When the bot joins a group it replies with the group's ID.

How a job moves:

1. A booking arrives in the admin group as job `J-1001` with buttons **ส่งงานให้ทีม** (send to team) and **ยกเลิกงาน** (cancel).
2. To ask for payment, the admin types `pay 1500 J-1001 …`. The slip is matched to the job automatically.
3. **ส่งงานให้ทีม** posts the job to the team group without the customer's phone number.
4. The team leader types `มอบ J-1001` and tags the person (`@name`). The bot replies with the full details and buttons: on the way, started, done, problem.
5. Photos that person sends in the team group are saved to their current job, including after photos up to 3 hours after "done".
6. Type `งาน J-1001` in any of the groups to see the job's status.

Each change updates one row per job in the Google Sheet. Photos and slips are copied to Google Drive (`YourestWedo job photos/J-1001`). To connect the sheet, follow the steps at the top of `tools/job-sheet.gs`, then add `SHEET_URL` and `SHEET_SECRET` in Cloudflare as Secrets. Type `sheet test` in the admin group to check the connection: the bot replies with what the sheet script answered and what to fix.

LINE counts each message the bot pushes to a group once per member, but replies to button taps and commands are free. On the free plan, keep groups small, or move to a paid plan when jobs grow.

### WhatsApp and LINE buttons

Every page shows floating chat buttons (contact.js, /api/contact).

- **WhatsApp:** +66 92 579 1876 (`WHATSAPP_PUBLIC` in worker.js). To use another number without changing code, set `WHATSAPP_NUMBER` in Cloudflare (e.g. `+66 81 234 5678` or `0812345678`). The button opens a chat with a message about the page's service.
- **LINE:** opens @chowrest (`LINE_PUBLIC_ID` in worker.js). To use a different link without changing code, set `LINE_ADD_URL` (e.g. `https://lin.ee/xxxx`). If `LINE_PUBLIC_ID` is emptied, the bot's own account is used.

A button only appears once its value is available.

## Before going live

- **Keep booked days up to date.** Each service's fully booked days are listed in `BOOKED` in `script.js`; they are not synced with Google Calendar.
- **Set the LINE secrets** (see "Booking requests on LINE") so booking requests reach the team.
- **Add contact details** (phone, LINE ID, email, address, opening hours) to the footer and booking section.
- **Confirm the service area** and any pricing you want to publish (the FAQ currently says prices are quoted per request).
- Optional: add a Thai-language version and real photography.
