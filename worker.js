// Cloudflare Worker: serves the static site and gives each service its own
// subdomain of chowrest-property.com. The bare chowrest-property.com is a
// separate Chowrest property site, so the YourestWedo main page lives on
// services.chowrest-property.com.
//   services.chowrest-property.com  -> index.html (YourestWedo main page)
//   cleaning.chowrest-property.com  -> cleaning.html
//   chauffeur.chowrest-property.com -> chauffeur.html
//   carwash.chowrest-property.com   -> carwash.html
//   grocery.chowrest-property.com   -> grocery.html
// On a service subdomain, a link to another service goes to that service's
// subdomain, and links to the main page go to services.chowrest-property.com.

const MAIN_DOMAIN = "chowrest-property.com";
const HOME_HOST = "services." + MAIN_DOMAIN; // YourestWedo main page
const SERVICES = ["cleaning", "chauffeur", "carwash", "grocery"];
const ASSET = /\.(css|js|png|jpe?g|gif|svg|webp|ico|woff2?|txt|xml|json)$/i;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const host = url.hostname.toLowerCase();
    const sub = host.endsWith("." + MAIN_DOMAIN)
      ? host.slice(0, -(MAIN_DOMAIN.length + 1))
      : "";

    // services., workers.dev and anything else: serve files as they are.
    if (!SERVICES.includes(sub) || ASSET.test(url.pathname)) {
      return env.ASSETS.fetch(request);
    }

    // The subdomain's home page is its service page.
    if (url.pathname === "/") {
      return env.ASSETS.fetch(new Request(new URL("/" + sub, url), request));
    }

    // Links to a service page go to that service's subdomain.
    const name = url.pathname.replace(/^\/+/, "").replace(/\.html$/, "");
    if (SERVICES.includes(name)) {
      return Response.redirect(`https://${name}.${MAIN_DOMAIN}/${url.search}`, 302);
    }

    // Everything else lives on the YourestWedo main page host.
    const path = url.pathname === "/index.html" || url.pathname === "/index" ? "/" : url.pathname;
    return Response.redirect(`https://${HOME_HOST}${path}${url.search}`, 302);
  },
};
