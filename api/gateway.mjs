import { handleRequest } from "../server.mjs";

export default function handler(request, response) {
  const url = new URL(request.url, "http://localhost");
  const service = url.searchParams.get("service");
  return handleRequest(request, response, "/api/" + service);
}
