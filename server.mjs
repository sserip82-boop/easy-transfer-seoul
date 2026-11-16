import http from "node:http";
import { readFile } from "node:fs/promises";

const port = Number(process.env.PORT || 4173);
const assets = new Map([
  ["/", ["index.html", "text/html"]],
  ["/index.html", ["index.html", "text/html"]],
  ["/style.css", ["style.css", "text/css"]],
  ...["app.js", "routes.js", "integrations.js"].map(name => ["/" + name, [name, "text/javascript"]]),
]);

async function fetchJson(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(7000) });
  if (!response.ok) throw new Error("Upstream error");
  return response.json();
}

async function seoul(kind, allStations = false) {
  const key = process.env.SEOUL_OPEN_API_KEY?.trim() || "sample";
  const sample = key === "sample";
  const service = kind === "locations" ? "getFcElvtr" : "SeoulMetroFaciInfo";
  const rows = [];
  const pageSize = sample ? 5 : 500;
  for (let first = 1; first <= 5000; first += pageSize) {
    const url = `http://openapi.seoul.go.kr:8088/${encodeURIComponent(key)}/json/${service}/${first}/${first + pageSize - 1}/`;
    const data = await fetchJson(url);
    const location = data.response;
    const status = data[service];
    const page = kind === "locations" ? location?.body?.items?.item : status?.row;
    const total = Number(kind === "locations" ? location?.body?.totalCount : status?.list_total_count);
    if (!Array.isArray(page) || !Number.isSafeInteger(total)) throw new Error("Unexpected response");
    rows.push(...page);
    if (sample || rows.length >= total) break;
    if (!page.length || first + pageSize > 5000) throw new Error("Incomplete response");
  }
  const isStation = name => /^충무로(?:역)?(?:\s*\([34]\))?$/.test((name || "").trim());
  const stationRows = kind === "status"
    ? rows.filter(row => allStations || isStation(row.STN_NM) || ["0331", "0423"].includes(String(row.STN_CD).trim()))
    : [];
  const facilities = kind === "locations"
    ? rows.filter(row => allStations || isStation(row.stnNm)).map(row => ({
        code: row.stnCd, name: row.fcltNm, line: row.lineNm, station: row.stnNm,
        place: row.dtlPstn, exit: row.vcntEntrcNo,
        floors: [row.bgngFlr, row.endFlr].filter(Boolean).join(" → "),
      }))
    : stationRows.filter(row => /^(?:승강기\s*\)\s*)?엘리베이터(?:\s|-|$)/.test((row.ELVTR_NM || "").trim())).map(row => ({
        code: row.STN_CD, name: row.ELVTR_NM, place: row.INSTL_PSTN,
        floors: row.OPR_SEC, state: row.USE_YN,
      }));
  return { sample, sampleRows: sample ? rows.length : undefined, facilities,
    stationRows: kind === "status" && !sample ? stationRows.length : undefined,
    fetchedAt: new Date().toISOString() };
}

async function closures(allStations = false) {
  const key = process.env.SEOUL_OPEN_API_KEY?.trim() || "sample";
  const sample = key === "sample";
  const size = sample ? 5 : 500;
  const notices = [];
  for (let first = 1; first <= 5000; first += size) {
    const url = `http://openapi.seoul.go.kr:8088/${encodeURIComponent(key)}/json/TbSubwayLineDetail/${first}/${first + size - 1}/`;
    const data = await fetchJson(url);
    if (first === 1 && data.RESULT?.CODE === "INFO-200") break;
    const page = data.TbSubwayLineDetail;
    if (page?.RESULT?.CODE !== "INFO-000" || !Array.isArray(page.row) ||
        !Number.isSafeInteger(page.list_total_count) || !page.row.length) {
      throw new Error("Unexpected closure response");
    }
    notices.push(...page.row);
    if (sample || notices.length >= page.list_total_count) break;
    if (first + size > 5000) throw new Error("Incomplete closure response");
  }
  const stationNotices = notices
    .filter(row => allStations || /^충무로(?:역)?(?:\s*\([34]\)?)?$/.test(row.SBWY_STNS_NM?.trim()))
    .map(row => ({
      station: row.SBWY_STNS_NM, line: row.LINE, place: row.CLSG_PLC, starts: row.BGNG_YMD?.slice(0, 10),
      ends: row.END_YMD?.slice(0, 10), reason: row.CLSG_RSN, alternative: row.RPLC_PATH,
    }));
  return { sample, sampleRows: sample ? notices.length : undefined, notices: stationNotices,
    fetchedAt: new Date().toISOString() };
}

async function transfer() {
  const key = process.env.KRIC_API_KEY?.trim();
  if (!key) return { configured: false };
  const url = new URL("https://openapi.kric.go.kr/openapi/vulnerableUserInfo/transferMovement");
  url.search = new URLSearchParams({
    serviceKey: key, format: "json", railOprIsttCd: "S1", lnCd: "3",
    stinCd: "321", prevStinCd: "422", chthTgtLn: "4", chtnNextStinCd: "424",
  });
  const data = await fetchJson(url);
  const rows = data.body ?? data.response?.body?.items?.item;
  if (!Array.isArray(rows) || !rows.length || !rows.every(row => typeof row.mvContDtl === "string")) {
    throw new Error("Unexpected transfer response");
  }
  return { configured: true, steps: rows.map(row => row.mvContDtl) };
}

async function interpretSearch(request, response) {
  const send = (code, body) => {
    response.writeHead(code, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
    response.end(JSON.stringify(body));
  };
  if (request.headers.origin !== `http://${request.headers.host}` ||
      request.headers["content-type"] !== "application/json") {
    return send(403, { error: "Invalid request origin" });
  }
  const key = process.env.GEMINI_API_KEY?.trim();
  if (!key) return send(200, { configured: false });
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 2048) return send(413, { error: "Query too large" });
    chunks.push(chunk);
  }
  let query;
  try { ({ query } = JSON.parse(Buffer.concat(chunks).toString("utf8"))); }
  catch { return send(400, { error: "Invalid query" }); }
  if (typeof query !== "string" || !query.trim() || query.length > 120) {
    return send(400, { error: "Invalid query" });
  }
  const model = process.env.GEMINI_MODEL?.trim() || "gemini-3.5-flash";
  const upstream = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": key },
    signal: AbortSignal.timeout(8000),
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: "한국어 지하철 엘리베이터 검색 조건을 추출한다. 역 이름, 숫자 호선, 출구 번호는 질문에 있는 값만 사용한다. 여러 역 또는 역명 없음은 station을 빈 문자열로 둔다. ground는 지상이나 출입구 이용을 원하는 경우에만 true다. 모르는 문자열은 빈 문자열로 반환한다." }] },
      contents: [{ parts: [{ text: query }] }],
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: {
          type: "OBJECT",
          properties: { station: { type: "STRING" }, line: { type: "STRING" }, exit: { type: "STRING" }, ground: { type: "BOOLEAN" } },
          required: ["station", "line", "exit", "ground"],
        },
      },
    }),
  });
  if (!upstream.ok) throw new Error("Gemini request failed");
  const payload = await upstream.json();
  const part = payload.candidates?.[0]?.content?.parts?.find(part => !part.thought && typeof part.text === "string");
  const result = JSON.parse(part?.text ?? "{}");
  const { station, line, exit, ground } = result;
  if (typeof station !== "string" || station.length > 50 ||
      typeof line !== "string" || !/^[1-9]?$/.test(line) ||
      typeof exit !== "string" || !/^\d{0,2}$/.test(exit) || typeof ground !== "boolean") {
    throw new Error("Invalid Gemini result");
  }
  return send(200, { configured: true, station, line, exit, ground });
}

const api = new Map([
  ["/api/config", () => ({ kakaoKey: process.env.KAKAO_JS_KEY?.trim() || "" })],
  ["/api/locations", () => seoul("locations")],
  ["/api/elevators", () => seoul("locations", true)],
  ["/api/status", () => seoul("status")],
  ["/api/elevator-statuses", () => seoul("status", true)],
  ["/api/closures", () => closures()],
  ["/api/station-closures", () => closures(true)],
  ["/api/transfer", transfer],
]);

const server = http.createServer(async (request, response) => {
  const path = request.url.split("?")[0];
  try {
    if (request.method === "POST" && path === "/api/interpret-search") {
      await interpretSearch(request, response);
    } else if (request.method !== "GET") {
      response.writeHead(405).end();
    } else if (api.has(path)) {
      const data = await api.get(path)();
      response.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
      response.end(JSON.stringify(data));
    } else if (assets.has(path)) {
      const [name, mime] = assets.get(path);
      const body = await readFile(new URL(name, import.meta.url));
      response.writeHead(200, { "Content-Type": mime + "; charset=utf-8" }).end(body);
    } else {
      response.writeHead(404).end();
    }
  } catch {
    response.writeHead(502, { "Content-Type": "application/json; charset=utf-8" });
    response.end(JSON.stringify({ error: "공식 API 응답을 확인하지 못했습니다." }));
  }
});
server.listen(port, "127.0.0.1", () => console.log(`http://localhost:${port}`));

