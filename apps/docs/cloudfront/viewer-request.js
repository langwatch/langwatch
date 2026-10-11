// The build replaces this declaration with the redirects from docs.json.
const redirects = {};

function redirectLocation({ destination, query }) {
  const parts = destination.split("#");
  const address = parts[0].split("?");
  const parameters = address[1] ? address[1].split("&") : [];
  const keys = parameters.map((item) => decodeURIComponent(item.split("=")[0].replace(/\+/g, " ")));
  Object.keys(query).forEach((key) => {
    const decodedKey = decodeURIComponent(key.replace(/\+/g, " "));
    if (!keys.includes(decodedKey)) {
      parameters.push(key + "=" + query[key].value);
    }
  });
  return (
    address[0] +
    (parameters.length ? "?" + parameters.join("&") : "") +
    (parts.length > 1 ? "#" + parts.slice(1).join("#") : "")
  );
}

export function handler(event) {
  const request = event.request;
  let pathname;
  try {
    pathname = decodeURIComponent(request.uri);
  } catch {
    return { statusCode: 400, statusDescription: "Bad Request" };
  }
  const source = pathname.replace(/\/$/, "");
  if (Object.prototype.hasOwnProperty.call(redirects, source)) {
    let location;
    try {
      location = redirectLocation({ destination: redirects[source], query: request.querystring });
    } catch {
      return { statusCode: 400, statusDescription: "Bad Request" };
    }
    return {
      statusCode: 301,
      statusDescription: "Moved Permanently",
      headers: {
        location: { value: location },
        "cache-control": { value: "public, max-age=60" },
      },
    };
  }
  const filename = pathname.split("/").pop();
  if (pathname.endsWith("/")) request.uri += "index.html";
  else if (!filename.includes(".")) request.uri += "/index.html";
  return request;
}
