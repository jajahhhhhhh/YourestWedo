// Cloudflare Pages: serve each service page on its own subdomain.
//   cleaning.chowrest-property.com  -> cleaning.html
//   chauffeur.chowrest-property.com -> chauffeur.html
//   carwash.chowrest-property.com   -> carwash.html
//   grocery.chowrest-property.com   -> grocery.html
// Any other page requested on a service subdomain is sent to the right place:
// another service page goes to that service's subdomain, everything else
// (the main page and its sections) goes to the main domain.

const MAIN_DOMAIN = "chowrest-property.com";
const SERVICES = ["cleaning", "chauffeur", "carwash", "grocery"];
const ASSET = /\.(css|js|png|jpe?g|gif|svg|webp|ico|woff2?|txt|xml|json)$/i;

export async function onRequest({ request, next, env }) {
  const url = new URL(request.url);
  const host = url.hostname.toLowerCase();
  if (!host.endsWith("." + MAIN_DOMAIN)) return next();

  const sub = host.slice(0, -(MAIN_DOMAIN.length + 1));
  if (!SERVICES.includes(sub)) return next();

  // Shared files (styles, scripts, images) load normally.
  if (ASSET.test(url.pathname)) return next();

  // The subdomain's home page is its service page.
  if (url.pathname === "/") {
    const page = new URL("/" + sub, url);
    return env.ASSETS.fetch(new Request(page, request));
  }

  // Links to a service page go to that service's subdomain.
  const name = url.pathname.replace(/^\/+/, "").replace(/\.html$/, "");
  if (SERVICES.includes(name)) {
    return Response.redirect(`https://${name}.${MAIN_DOMAIN}/${url.search}`, 302);
  }

  // Everything else (index.html, sections of the main page) lives on the main domain.
  const path = url.pathname === "/index.html" || url.pathname === "/index" ? "/" : url.pathname;
  return Response.redirect(`https://${MAIN_DOMAIN}${path}${url.search}`, 302);
}
