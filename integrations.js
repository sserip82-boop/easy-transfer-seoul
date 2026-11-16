const message = id => document.getElementById(id);

async function readApi(path) {
  const response = await fetch("/api/" + path, { signal: AbortSignal.timeout(18000) });
  if (!response.ok) throw new Error("API unavailable");
  return response.json();
}

let kakaoMapsPromise;

async function loadKakaoMaps() {
  const { kakaoKey } = await readApi("config");
  if (!kakaoKey) throw new Error("카카오 JavaScript 키 설정 후 지도를 표시합니다.");
  const script = document.createElement("script");
  script.src = "https://dapi.kakao.com/v2/maps/sdk.js?autoload=false&libraries=services&appkey=" + encodeURIComponent(kakaoKey);
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("카카오 지도를 불러오지 못했습니다.")), 8000);
    script.onload = () => {
      clearTimeout(timer);
      resolve();
    };
    script.onerror = () => {
      clearTimeout(timer);
      reject(new Error("카카오 지도를 불러오지 못했습니다."));
    };
    document.head.append(script);
  });
  const maps = window.kakao?.maps;
  if (!maps?.load) throw new Error("카카오 지도를 불러오지 못했습니다.");
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("카카오 지도 응답이 지연되고 있습니다.")), 8000);
    maps.load(() => {
      clearTimeout(timer);
      resolve();
    });
  });
  return maps;
}

function findElevatorPlace(places, label) {
  const compact = value => value.replace(/\s+/g, "");
  const matches = places.filter(place => compact(place.place_name || "") === compact(label) &&
    Number(place.distance) > 0 && Number(place.distance) <= 350 &&
    Number(place.y) > 37 && Number(place.y) < 38 &&
    Number(place.x) > 126 && Number(place.x) < 128);
  return matches.length === 1 ? matches[0] : null;
}

async function showMap(container, status, station, line, elevatorCard) {
  try {
    const maps = await (kakaoMapsPromise ??= loadKakaoMaps());
    const label = stationName(station) + "역";
    const query = [label, line].filter(Boolean).join(" ");
    const candidates = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("역 위치 검색이 지연되고 있습니다.")), 8000);
      new maps.services.Places().keywordSearch(query, (results, result) => {
        clearTimeout(timer);
        resolve(result === maps.services.Status.OK ? results : []);
      }, { category_group_code: "SW8" });
    });
    if (!container.isConnected) return;
    const compact = name => name.replace(/\s+/g, "");
    const matches = candidates.filter(place => place.category_group_code === "SW8" &&
      [label, query].some(name => compact(name) === compact(place.place_name)));
    const place = matches.find(place => compact(place.place_name) === compact(query)) || matches[0];
    if (!place || !Number.isFinite(Number(place.y)) || !Number.isFinite(Number(place.x))) {
      status.textContent = `지도에서 ${label} 위치를 확인하지 못했습니다.`;
      return;
    }
    const point = new maps.LatLng(Number(place.y), Number(place.x));
    container.hidden = false;
    const map = new maps.Map(container, { center: point, level: 3 });
    new maps.Marker({ map, position: point, title: label });
    status.textContent = `${label} 위치 · 핀은 역 위치를 표시합니다.`;
    if (elevatorCard) {
      const elevatorLabel = "충무로역 7번 출입구 엘리베이터";
      const facilityStatus = document.createElement("small");
      facilityStatus.className = "elevator-note";
      facilityStatus.textContent = "개별 엘리베이터 좌표 확인 중";
      elevatorCard.append(facilityStatus);
      const timeout = setTimeout(() => {
        facilityStatus.textContent = "카카오 장소 검색 응답 지연 · 개별 좌표 미확인";
      }, 8000);
      new maps.services.Places().keywordSearch(elevatorLabel, (results, result) => {
        clearTimeout(timeout);
        if (!container.isConnected) return;
        if (result !== maps.services.Status.OK) {
          facilityStatus.textContent = result === maps.services.Status.ZERO_RESULT
            ? "카카오 장소 검색 결과 없음 · 개별 좌표 미확인"
            : "카카오 장소 검색 응답 오류 · 개별 좌표 미확인";
          return;
        }
        const elevator = findElevatorPlace(results, elevatorLabel) ||
          findElevatorPlace(results, "충무로역 7번출구 엘리베이터");
        if (!elevator) {
          facilityStatus.textContent = "카카오 검색 결과에서 7번 출입구 엘리베이터를 특정하지 못했습니다.";
          return;
        }
        facilityStatus.textContent = "카카오 장소 검색에서 개별 좌표 확인";
        const position = new maps.LatLng(Number(elevator.y), Number(elevator.x));
        const marker = new maps.Marker({ map, position, title: elevatorLabel, clickable: true });
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = "지도에서 엘리베이터 보기";
        button.onclick = () => {
          map.panTo(position);
          container.scrollIntoView({ block: "nearest" });
        };
        elevatorCard.tabIndex = -1;
        elevatorCard.append(button);
        maps.event.addListener(marker, "click", () => {
          if (!elevatorCard.hidden) elevatorCard.focus();
        });
        status.textContent = "충무로역 위치와 7번 출입구 엘리베이터 · 시설 좌표 출처 카카오 장소 검색";
      }, { location: point, radius: 350 });
    }
  } catch (error) {
    container.hidden = true;
    status.textContent = error instanceof Error ? error.message : "카카오 지도를 불러오지 못했습니다.";
  }
}

function isDemoElevator(facility) {
  return facility.code === "0423" && facility.place === "7번 출입구" &&
    facility.name?.endsWith("외부#1");
}

function facilityState(facility, status) {
  if (!status || status.sample) return null;
  const matches = status.facilities.filter(row => row.code === facility.code && row.name === facility.name);
  return matches.length === 1 ? matches[0].state : null;
}

function exitClosureText(data) {
  if (!data || data.sample) return "충무로 공사 공지 미확인";
  const today = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Seoul" })
    .format(new Date(data.fetchedAt));
  const notices = data.notices.filter(notice => /(^|[^0-9])7\s*번/.test(notice.place || ""));
  const active = notices.find(notice => notice.starts && notice.ends &&
    notice.starts <= today && today <= notice.ends);
  if (active) return `공사 공지 있음 · ${active.place} · ${active.ends}까지`;
  if (notices.some(notice => !notice.starts || !notice.ends)) return "7번 관련 공지 있음 · 적용 기간 확인 필요";
  return "조회 자료에서 적용 중인 7번 공지 없음 · 현장 안내 확인";
}

function findExitPath(edges, start, end, blockedFacilities) {
  const paths = [[start]];
  const visited = new Set([start]);
  for (const path of paths) {
    const node = path.at(-1);
    if (node === end) return path;
    for (const edge of edges) {
      if (edge.from !== node || blockedFacilities.has(edge.facility) || visited.has(edge.to)) continue;
      visited.add(edge.to);
      paths.push([...path, edge.to]);
    }
  }
  return null;
}

function formatElevatorFloors(floors) {
  return (floors || "").split(" → ").map(value => {
    const floor = value.trim();
    const underground = /^B([1-9]\d*)F?$/i.exec(floor);
    const aboveGround = /^([1-9]\d*)F?$/i.exec(floor);
    if (underground) return `지하 ${underground[1]}층`;
    if (aboveGround) return `지상 ${aboveGround[1]}층`;
    return floor;
  }).filter(Boolean).join(" ↔ ");
}

function showExitRoute(facility, closures, outage) {
  const ground = "지상 1층 · 7번 출입구 인근";
  const basement = "지하 1층 · 엘리베이터 하차 지점";
  // The installation data confirms the lift segment only.
  const floors = facility.floors?.split(" → ").map(floor => floor.trim().toUpperCase()) || [];
  const hasSegment = floors.length === 2 && floors.includes("B1") && floors.some(floor => /^1F?$/.test(floor));
  const edges = hasSegment ? [{ from: ground, to: basement, facility: facility.name }] : [];
  const blocked = new Set();
  if (outage || facility.state?.trim() !== "사용가능" ||
      !exitClosureText(closures).startsWith("조회 자료에서 적용 중인")) {
    blocked.add(facility.name);
  }
  const path = findExitPath(edges, ground, basement, blocked);
  const result = message("outage-result");
  if (path) {
    result.textContent = `${path.join(" → ")} · 공식 시설 정보로 확인한 엘리베이터 구간입니다. 현장 안내를 확인하세요.`;
    return;
  }
  const reason = outage ? "시연용 가상 고장 · " : "";
  result.textContent = reason + "출입 안내 보류 · 다른 출입구에서 같은 지하 연결 지점까지 이어지는 계단 없는 우회 경로는 미확인입니다. 역무원에게 문의하세요.";
}

function renderFacilities(location, status, closures = null) {
  const hasDemoElevator = !location.sample && location.facilities.filter(isDemoElevator).length === 1;
  const demo = document.querySelector(".outage-demo");
  const button = message("outage-toggle");
  demo.hidden = !hasDemoElevator;
  message("outage-availability").hidden = hasDemoElevator;
  const outage = hasDemoElevator && button.getAttribute("aria-pressed") === "true";
  const facilities = location.facilities.map(facility => {
    return { ...facility, state: facilityState(facility, status) };
  });
  const items = facilities.map(facility => {
    const { state } = facility;
    const item = document.createElement("li");
    item.textContent = [facility.line, facility.name, facility.place, formatElevatorFloors(facility.floors), state || "가동 상태 미확인"].filter(Boolean).join(" · ");
    if (outage && isDemoElevator(facility)) {
      item.textContent += " · 시연용 가상 고장";
    }
    if (hasDemoElevator && isDemoElevator(facility)) {
      message("exit-location").textContent = [facility.place, formatElevatorFloors(facility.floors)].filter(Boolean).join(" · ");
      message("exit-operation").textContent = state || "가동 상태 미확인";
      message("exit-closure").textContent = exitClosureText(closures);
      showExitRoute(facility, closures, outage);
    }
    return item;
  });
  message("facilities").replaceChildren(...items);
  button.onclick = () => {
    const active = !outage;
    button.setAttribute("aria-pressed", String(active));
    button.textContent = active ? "가상 고장 해제" : "가상 고장 적용";
    renderFacilities(location, status, closures);
  };
  return facilities;
}

async function showClosures() {
  const status = message("closures-status");
  const data = await readApi("closures").catch(() => null);
  if (!data || data.sample) {
    status.textContent = data
      ? `공개 샘플 ${data.sampleRows}건 응답 · 충무로 공지 확인은 서울시 인증키 필요`
      : "공사현황 API 응답 미확인";
    return null;
  }
  const time = new Date(data.fetchedAt).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" });
  status.textContent = `충무로 공사 공지 ${data.notices.length}건 · 조회 ${time}`;
  if (!data.notices.length) {
    status.textContent += " · 실제 출입 가능 여부는 현장 안내를 확인하세요.";
    return data;
  }
  const list = message("closures-list");
  list.hidden = false;
  list.replaceChildren(...data.notices.map(notice => {
    const item = document.createElement("li");
    item.textContent = [
      notice.line, notice.place, [notice.starts, notice.ends].filter(Boolean).join(" ~ "),
      notice.reason, notice.alternative && `공사 안내문 대체 경로 ${notice.alternative} (무단차 여부 미확인)`,
    ].filter(Boolean).join(" · ");
    return item;
  }));
  return data;
}

function showOfflineOutage() {
  message("offline-outage").hidden = false;
  const button = message("offline-outage-toggle");
  const result = message("offline-outage-result");
  const edges = [{ from: "지상 1층", to: "지하 1층", facility: "7번 출입구 엘리베이터" }];
  function render(outage) {
    const blocked = new Set(outage ? [edges[0].facility] : []);
    const route = findExitPath(edges, "지상 1층", "지하 1층", blocked);
    button.setAttribute("aria-pressed", String(outage));
    button.textContent = outage ? "가상 고장 해제" : "가상 고장 적용";
    result.textContent = route
      ? `시연용 정상 가정 · ${route.join(" → ")}`
      : "시연용 가상 고장 · 출입 안내 보류 · 계단 없는 우회 경로 미확인 · 역무원에게 문의하세요.";
  }
  button.onclick = () => render(button.getAttribute("aria-pressed") !== "true");
  render(false);
}

const staticDemo = location.protocol === "file:" || location.hostname?.endsWith(".github.io");

async function loadIntegrations() {
  if (staticDemo) {
    message("offline-note").hidden = false;
    showOfflineOutage();
    message("find-elevator").hidden = true;
    message("find-transfer-elevators").hidden = true;
    document.querySelector(".quick-nav").hidden = true;
    document.querySelector(".integrations").hidden = true;
    return;
  }
  void showMap(message("station-map"), message("map-status"), "충무로", "3호선");
  const closuresPending = showClosures();
  const locationData = await readApi("locations").catch(() => null);
  message("locations-status").textContent = locationData
    ? locationData.sample ? `공개 샘플 ${locationData.sampleRows}건 응답 · 충무로 조회는 발급 키 필요` : `충무로 위치 ${locationData.facilities.length}건`
    : "위치 API 응답 미확인";
  if (locationData) renderFacilities(locationData, null);

  const status = await readApi("status").catch(() => null);
  message("operation-status").textContent = status
    ? status.sample ? `공개 샘플 ${status.sampleRows}건 응답 · 충무로 조회는 발급 키 필요`
      : `충무로 엘리베이터 상태 ${status.facilities.length}건 · 조회 ${new Date(status.fetchedAt).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })}`
    : "가동현황 API 응답 미확인";
  if (locationData) {
    const facilities = renderFacilities(locationData, status);
    updateRouteFacilities(locationData.sample ? [] : facilities);
  }
  void closuresPending.then(closures => {
    if (locationData) renderFacilities(locationData, status, closures);
  });

  const transfer = await readApi("transfer").catch(() => null);
  message("transfer-status").textContent = transfer?.configured
    ? `KRIC 공식 충무로 예제 응답 ${transfer.steps.length}단계 · 위 환승 안내는 공식 CSV 기준`
    : transfer ? "KRIC 활용 키 설정 대기 · 공식 CSV 표시 중" : "KRIC 응답 미확인 · 공식 CSV 표시 중";
  if (transfer?.configured) {
    message("transfer-preview").replaceChildren(...transfer.steps.map(step => {
      const item = document.createElement("li");
      item.textContent = step;
      return item;
    }));
  }
}

function stationName(value) {
  return (value || "").trim().replace(/\s*\((?:[0-9]+\)?)?$/, "").replace(/역$/, "").replace(/\s+/g, "");
}

function matchingExitNotices(facility, data) {
  if (!data || data.sample || !facility.line) return [];
  const exit = /^(\d+)(?:\s*번(?:\s*출(?:입)?구)?)?$/.exec(String(facility.exit ?? "").trim())?.[1];
  if (!exit) return [];
  return data.notices.filter(notice => stationName(notice.station) === stationName(facility.station) &&
    notice.line?.replace(/\s/g, "") === facility.line.replace(/\s/g, "") &&
    new RegExp(`^${exit}\\s*번\\s*출(?:입)?구\\s*$`).test(notice.place?.trim() || ""));
}

function exitNoticeForCopy(facility, data) {
  if (data === undefined) return "출입구 공사 공지 조회 중";
  if (!data || data.sample) return "출입구 공사 공지 미확인";
  const notices = matchingExitNotices(facility, data);
  if (!notices.length) return "조회 자료에 이 시설의 출입구와 일치하는 공지 없음 · 현장 안내 확인";
  return notices.map(notice => [
    "해당 출입구 공사 공지", notice.place,
    [notice.starts, notice.ends].filter(Boolean).join(" ~ "), notice.reason,
  ].filter(Boolean).join(" · ")).join("\n");
}

function facilityMapLink(facility) {
  const station = stationName(facility.station);
  if (!station) return null;
  const exit = /^(\d{1,3})(?:\s*번(?:\s*출(?:입)?구)?)?$/.exec(String(facility.exit ?? "").trim())?.[1];
  const target = exit ? `${exit}번 출구` : facility.line;
  const query = [station + "역", target].filter(Boolean).join(" ");
  const label = exit ? "카카오맵 출입구 검색" : "카카오맵 역 위치 검색";
  return { label, href: `https://map.kakao.com/link/search/${encodeURIComponent(query)}`, exit };
}

function showStationNotices(section, station, line, data) {
  if (!data || data.sample) {
    section.textContent = "출입구 공사 공지 미확인";
    return;
  }
  const notices = data.notices.filter(notice => stationName(notice.station) === stationName(station) &&
    (!line || !notice.line || notice.line.trim() === line.trim()));
  section.textContent = notices.length
    ? `역 공사 공지 ${notices.length}건 · 공사 기간과 현장 안내를 확인하세요.`
    : "조회 자료에 해당 역·호선 공사 공지 없음 · 현장 안내 확인";
  if (!notices.length) return;
  const list = document.createElement("ul");
  for (const notice of notices) {
    const item = document.createElement("li");
    item.textContent = [notice.place, [notice.starts, notice.ends].filter(Boolean).join(" ~ "),
      notice.reason, notice.alternative && `공사 안내문 대체 경로 ${notice.alternative} (계단 없는 이동 여부 미확인)`]
      .filter(Boolean).join(" · ");
    list.append(item);
  }
  section.append(list);
}

let elevatorDirectory;
const savedStationsKey = "easy-transfer-saved-stations";
let savedStations = [];
try {
  const stored = JSON.parse(localStorage.getItem(savedStationsKey) || "[]");
  if (Array.isArray(stored)) savedStations = stored.filter(value => typeof value === "string");
} catch {
  // Search still works when browser storage is unavailable.
}

let linkedFilters;

function searchStation(station, initialFilters) {
  const form = message("elevator-search");
  const button = form.querySelector('button[type="submit"]');
  if (button.disabled) return;
  message("station-search").value = station;
  linkedFilters = initialFilters;
  form.requestSubmit(button);
  linkedFilters = undefined;
}

function setStationSaved(station, saved) {
  const next = saved ? [...savedStations, station] : savedStations.filter(value => value !== station);
  const feedback = message("saved-station-feedback");
  try {
    localStorage.setItem(savedStationsKey, JSON.stringify(next));
  } catch {
    feedback.textContent = "이 브라우저에서 즐겨찾기를 변경하지 못했습니다.";
    return false;
  }
  savedStations = next;
  renderSavedStations();
  feedback.textContent = `${station}역 즐겨찾기 ${saved ? "추가" : "해제"} 완료`;
  return true;
}

function renderSavedStations() {
  const list = message("saved-station-list");
  list.replaceChildren(...savedStations.map(station => {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = station + "역";
    button.onclick = () => searchStation(station);
    const remove = document.createElement("button");
    remove.type = "button";
    remove.textContent = "해제";
    remove.setAttribute("aria-label", station + "역 즐겨찾기 해제");
    remove.onclick = () => {
      if (setStationSaved(station, false)) message("station-search").focus();
    };
    const group = document.createElement("div");
    group.className = "saved-station";
    group.append(button, remove);
    return group;
  }));
  message("saved-stations").hidden = !savedStations.length;
  for (const button of document.querySelectorAll("[data-save-station]")) {
    const saved = savedStations.includes(button.dataset.saveStation);
    button.textContent = saved ? "즐겨찾기 해제" : "즐겨찾기 추가";
    button.setAttribute("aria-pressed", String(saved));
  }
}

function reachesGround(facility) {
  return Boolean(facility.floors?.split(" → ").some(floor => /^1F?$/i.test(floor.trim())));
}

function passesFacilityFilters(facility, state, groundOnly, usableOnly) {
  return (!groundOnly || reachesGround(facility)) &&
    (!usableOnly || state?.trim() === "사용가능");
}

function searchElevators(query, facilities) {
  const names = [...new Set(facilities.map(row => stationName(row.station)).filter(Boolean))];
  const exact = stationName(query);
  if (names.includes(exact)) return { matches: facilities.filter(row => stationName(row.station) === exact) };
  const words = query.match(/[가-힣A-Za-z0-9]+/g) || [];
  const mentioned = new Set(words.map(word => names
    .filter(name => word === name || (word.startsWith(name) &&
      /^(?:역(?:에서|으로|에는|에|은|는|의|을|를|과|와)?|에서|으로|에)$/.test(word.slice(name.length))))
    .sort((a, b) => b.length - a.length)[0]).filter(Boolean));
  if (mentioned.size > 1) return { message: "한 번에 역 한 곳을 입력하세요." };
  const ground = /지상|바깥|밖으로|외부|출구|출입구/.test(query);
  const line = query.match(/\b([1-9])\s*호선/)?.[1];
  const station = [...mentioned][0];
  const exit = query.match(/(?:^|[^0-9])(\d+)\s*번\s*(?:출입구|출구)/)?.[1];
  const matches = facilities.filter(row => {
    const name = stationName(row.station);
    if (!name || (station ? name !== station : !name.includes(exact))) return false;
    if (line && row.line?.replace(/\s+/g, "") !== line + "호선") return false;
    if (ground && !reachesGround(row)) return false;
    if (exit && !new RegExp(`^(?:${exit}(?:\\s*번(?:\\s*출(?:입)?구)?)?)$`).test(String(row.exit ?? "").trim())) return false;
    return true;
  });
  const label = [station, line && line + "호선", exit ? exit + "번 출입구 인근" : ground && "지상 연결"].filter(Boolean).join(" · ");
  if (!matches.length && ground && station) {
    return { message: `${label} 조건에 맞는 시설을 공식 목록에서 확인하지 못했습니다.` };
  }
  return { matches, label, ground, exit };
}

function summarizeElevators(count, usable, reported, ground) {
  const facility = ground ? "지상 연결 엘리베이터" : "엘리베이터";
  const counts = [];
  if (usable) counts.push(`사용 가능 ${usable}대`);
  if (reported > usable) counts.push(`기타 공식 상태 ${reported - usable}대`);
  if (count > reported) counts.push(`상태 미확인 ${count - reported}대`);
  return `공식 목록에서 ${facility} ${count}대를 찾았어요. 조회 결과는 ${counts.join(", ")}입니다.`;
}

message("elevator-search").addEventListener("submit", async event => {
  event.preventDefault();
  const form = event.currentTarget;
  const query = message("station-search").value.trim();
  const status = message("station-search-status");
  const results = message("station-search-results");
  const searchSummary = message("station-search-summary");
  const filters = message("facility-filters");
  const refreshOperation = message("refresh-operation");
  const groundFilter = message("filter-ground");
  const usableFilter = message("filter-usable");
  const buttons = [...form.querySelectorAll("button")];
  if (buttons[0].disabled) return;
  results.replaceChildren();
  searchSummary.hidden = true;
  filters.hidden = true;
  filters.onchange = null;
  refreshOperation.onclick = null;
  groundFilter.checked = Boolean(linkedFilters?.ground);
  usableFilter.checked = Boolean(linkedFilters?.usable);
  const linkedLine = linkedFilters?.line;
  if (!stationName(query)) {
    status.textContent = "역 이름을 입력하세요.";
    return;
  }
  buttons.forEach(button => { button.disabled = true; });
  status.textContent = "시설 목록을 불러오는 중입니다.";
  try {
    const data = elevatorDirectory ?? await readApi("elevators");
    if (data.sample) {
      status.textContent = "전체 역 검색에는 서울시 일반 인증키가 필요합니다.";
      return;
    }
    elevatorDirectory = data;
    let search = searchElevators(query, data.facilities);
    let mode = "";
    if (event.submitter?.value === "ai" && !search.message) {
      status.textContent = "AI가 검색 조건을 확인하는 중입니다.";
      try {
        const response = await fetch("/api/interpret-search", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ query }),
          signal: AbortSignal.timeout(10000),
        });
        if (!response.ok) throw new Error("AI unavailable");
        const intent = await response.json();
        const name = stationName(intent.station);
        const compactQuery = query.replace(/\s+/g, "");
        if (intent.configured && name && compactQuery.includes(name) &&
            data.facilities.some(row => stationName(row.station) === name) &&
            (!intent.line || compactQuery.includes(intent.line + "호선")) &&
            (!intent.exit || compactQuery.includes(intent.exit + "번"))) {
          const parts = [name + "역", intent.line && intent.line + "호선",
            intent.exit && intent.exit + "번 출입구", intent.ground && "지상"];
          search = searchElevators(parts.filter(Boolean).join(" "), data.facilities);
          mode = "AI 조건 해석 · ";
        } else {
          mode = intent.configured ? "AI 조건 미확인 · 기본 검색 · " : "AI 키 미설정 · 기본 검색 · ";
        }
      } catch {
        mode = "AI 응답 미확인 · 기본 검색 · ";
      }
    }
    const { matches: found, message: searchMessage, label, ground, exit: searchExit } = search;
    if (searchMessage) {
      status.textContent = mode + searchMessage;
      return;
    }
    const matches = linkedLine
      ? found.filter(row => row.line?.replace(/\s+/g, "") === linkedLine)
      : found;
    if (!matches.length) {
      status.textContent = mode + "이 조건으로 등록된 시설을 찾지 못했습니다. 역 이름과 조건을 확인해 주세요.";
      return;
    }
    const resultLabel = `${mode}${label || query}${linkedLine ? " · " + linkedLine : ""} 검색 결과 ${matches.length}건`;
    status.textContent = `${resultLabel} · 가동현황 조회 중`;
    const statusRows = [];
    const noticeSections = [];
    const noticesPending = readApi("station-closures").catch(() => null);
    const stations = Map.groupBy(matches, row => `${row.code || row.station}|${row.line || ""}`);
    for (const facilities of stations.values()) {
      const { station, line } = facilities[0];
      const heading = document.createElement("h2");
      heading.textContent = `${station} · ${line || "호선 미확인"}`;
      const link = document.createElement("a");
      link.href = "https://map.kakao.com/link/search/" + encodeURIComponent(`${stationName(station)}역 ${line || ""}`);
      link.textContent = "카카오맵에서 역 위치 보기";
      const list = document.createElement("ul");
      list.className = "facility-cards";
      let elevatorCard;
      const uniqueElevator = facilities.filter(isDemoElevator).length === 1;
      for (const facility of facilities) {
        const item = document.createElement("li");
        if (uniqueElevator && isDemoElevator(facility)) elevatorCard = item;
        const exit = /^\d+$/.test(facility.exit || "") ? facility.exit + "번 출입구 인근" : facility.exit;
        const title = document.createElement("h3");
        title.textContent = exit || "인근 출입구 미확인";
        const details = document.createElement("p");
        const floorLabel = formatElevatorFloors(facility.floors);
        details.textContent = [facility.place, floorLabel && `운행 층 ${floorLabel}`].filter(Boolean).join(" · ") || "상세 위치 및 운행 층 미확인";
        const name = document.createElement("small");
        name.textContent = facility.name || "";
        const operation = document.createElement("small");
        operation.className = "facility-status";
        operation.dataset.state = "pending";
        operation.textContent = "공식 가동현황 조회 중";
        const work = document.createElement("ul");
        work.className = "facility-work";
        work.hidden = true;
        const copy = document.createElement("button");
        copy.type = "button";
        copy.className = "save-station";
        copy.textContent = "시설 정보 복사";
        copy.disabled = true;
        const feedback = document.createElement("small");
        feedback.className = "elevator-note";
        feedback.setAttribute("role", "status");
        const checkedAt = document.createElement("small");
        checkedAt.className = "elevator-note";
        const row = { facility, operation, item, work, copy, checkedAt };
        const mapLink = facilityMapLink(facility);
        copy.onclick = async () => {
          const text = [heading.textContent, title.textContent, details.textContent,
            name.textContent, operation.textContent, row.timestamp && `가동현황 조회 시각 ${row.timestamp}`,
            exitNoticeForCopy(facility, row.closureData), mapLink && `${mapLink.label} ${mapLink.href}`]
            .filter(Boolean).join("\n");
          try {
            await navigator.clipboard.writeText(text);
            feedback.textContent = "시설 정보를 복사했습니다.";
          } catch {
            feedback.textContent = "복사할 수 없습니다. 카드의 내용을 직접 선택해 복사해 주세요.";
          }
        };
        const cardHeader = document.createElement("div");
        cardHeader.className = "facility-card-header";
        cardHeader.append(title, operation);
        item.append(cardHeader, details, name, checkedAt, work);
        if (mapLink?.exit) {
          const link = document.createElement("a");
          link.className = "facility-map-link";
          link.href = mapLink.href;
          link.textContent = `카카오맵에서 ${mapLink.exit}번 출구 검색`;
          item.append(link);
        }
        item.append(copy, feedback);
        statusRows.push(row);
        list.append(item);
      }
      const map = document.createElement("div");
      map.className = "search-station-map";
      map.hidden = true;
      map.setAttribute("aria-label", `${station} ${line || ""} 지도`);
      const mapStatus = document.createElement("p");
      mapStatus.textContent = "카카오 지도 불러오는 중";
      const notices = document.createElement("div");
      notices.className = "station-notices";
      notices.textContent = "출입구 공사 공지 조회 중";
      noticeSections.push({ notices, station, line });
      results.append(heading);
      const saveButton = document.createElement("button");
      saveButton.type = "button";
      saveButton.className = "save-station";
      saveButton.dataset.saveStation = stationName(station);
      saveButton.onclick = () => {
        const key = saveButton.dataset.saveStation;
        setStationSaved(key, !savedStations.includes(key));
      };
      results.append(saveButton);
      if (location.protocol === "http:" || location.protocol === "https:") {
        const share = document.createElement("button");
        share.type = "button";
        share.className = "save-station";
        share.textContent = "역 링크 복사";
        const shareFeedback = document.createElement("small");
        shareFeedback.className = "elevator-note";
        shareFeedback.setAttribute("role", "status");
        share.onclick = async () => {
          const url = new URL(location.pathname, location.origin);
          url.searchParams.set("station", stationName(station));
          if (/^[1-9]호선$/.test(line?.replace(/\s+/g, ""))) {
            url.searchParams.set("line", line.replace(/\s+/g, ""));
          }
          if (ground || groundFilter.checked) url.searchParams.set("ground", "1");
          if (searchExit) url.searchParams.set("exit", searchExit);
          if (usableFilter.checked) url.searchParams.set("usable", "1");
          try {
            await navigator.clipboard.writeText(url.href);
            shareFeedback.textContent = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(url.hostname)
              ? "복사 완료 · 이 주소는 앱을 실행하는 컴퓨터에서 열 수 있습니다."
              : "역 링크를 복사했습니다.";
          } catch {
            shareFeedback.textContent = url.href;
          }
        };
        results.append(share, shareFeedback);
      }
      const transferSelect = message("transfer-station");
      const transferStationName = stationName(station);
      if (Array.from(transferSelect.options).some(option => option.value === transferStationName)) {
        const transferLink = document.createElement("a");
        transferLink.href = "#transfer-guide";
        transferLink.textContent = `${transferStationName}역 환승 안내 보기`;
        transferLink.addEventListener("click", () => {
          if (transferSelect.value !== transferStationName) {
            transferSelect.value = transferStationName;
            transferSelect.dispatchEvent(new Event("change"));
          }
        });
        results.append(transferLink);
      }
      results.append(list, map, mapStatus, link, notices);
      const hyehwaGround = facilities.filter(facility => facility.code === "0420" && reachesGround(facility));
      if (hyehwaGround.some(facility => facility.place === "2번 출입구") &&
          hyehwaGround.some(facility => facility.place === "3번 출입구")) {
        const accessNote = document.createElement("p");
        accessNote.className = "station-notices";
        accessNote.textContent = "2번·3번 출입구 엘리베이터 모두 지하 1층과 지상을 연결합니다. 두 엘리베이터 사이의 계단 없는 연결은 미확인입니다. 한쪽을 이용하기 어려우면 역무원에게 이동 동선을 확인하세요.";
        list.before(accessNote);
      }
      void showMap(map, mapStatus, station, line, elevatorCard);
    }
    renderSavedStations();
    void noticesPending.then(data => {
      for (const { notices, station, line } of noticeSections) showStationNotices(notices, station, line, data);
      for (const row of statusRows) {
        row.closureData = data;
        const { facility, work } = row;
        const notices = matchingExitNotices(facility, data);
        for (const notice of notices) {
          const item = document.createElement("li");
          item.textContent = ["해당 출입구 공사 공지", [notice.starts, notice.ends].filter(Boolean).join(" ~ "), notice.reason].filter(Boolean).join(" · ");
          work.append(item);
        }
        work.hidden = !notices.length;
      }
    });
    const applyFilters = () => {
      let visible = 0;
      for (const { facility, state, item } of statusRows) {
        item.hidden = !passesFacilityFilters(facility, state, groundFilter.checked, usableFilter.checked);
        if (!item.hidden) visible++;
      }
      message("filter-count").textContent = visible
        ? `검색 결과 ${matches.length}대 중 ${visible}대 표시`
        : "선택한 조건을 충족하는 시설을 확인하지 못했습니다.";
    };
    const refreshStatuses = async () => {
      buttons.forEach(button => { button.disabled = true; });
      refreshOperation.disabled = true;
      for (const row of statusRows) row.copy.disabled = true;
      status.textContent = `${resultLabel} · 가동현황 다시 조회 중`;
      try {
        const response = await readApi("elevator-statuses").catch(() => null);
        const operations = response?.sample === false && Array.isArray(response.facilities) &&
          Number.isFinite(Date.parse(response.fetchedAt)) ? response : null;
        const available = Boolean(operations);
        const timestamp = available
          ? new Date(operations.fetchedAt).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })
          : "";
        let matched = 0;
        let usable = 0;
        for (const row of statusRows) {
          const { facility, operation } = row;
          const state = row.state = facilityState(facility, operations);
          row.timestamp = timestamp;
          row.checkedAt.textContent = timestamp ? `가동현황 조회 시각 ${timestamp}` : "가동현황 조회 시각 미확인";
          if (state) matched++;
          if (state?.trim() === "사용가능") usable++;
          operation.textContent = state ? `공식 가동 상태 ${state}` : "가동 상태 미확인";
          operation.dataset.state = state?.trim() === "사용가능" ? "available"
            : state?.trim() === "사용불가" ? "unavailable" : "unknown";
        }
        status.textContent = available
          ? `${resultLabel} · 가동 상태 연결 ${matched}건 · 조회 ${timestamp}`
          : `${resultLabel} · 가동현황을 확인하지 못했습니다. ‘가동 상태 다시 확인’으로 재시도할 수 있습니다.`;
        searchSummary.textContent = summarizeElevators(matches.length, usable, matched, ground);
        searchSummary.hidden = false;
        applyFilters();
      } finally {
        for (const row of statusRows) row.copy.disabled = false;
        refreshOperation.disabled = false;
        buttons.forEach(button => { button.disabled = false; });
      }
    };
    refreshOperation.onclick = refreshStatuses;
    filters.onchange = applyFilters;
    await refreshStatuses();
    filters.hidden = false;
  } catch {
    status.textContent = "시설 목록을 불러오지 못했습니다. 앱을 다시 실행한 뒤 검색해 주세요.";
  } finally {
    buttons.forEach(button => { button.disabled = false; });
  }
});

message("find-transfer-elevators").addEventListener("click", () => {
  const field = message("station-search");
  searchStation(message("transfer-station").value);
  field.focus();
  message("find-elevator").scrollIntoView({ block: "start" });
});

renderSavedStations();
loadIntegrations();
const linkedQuery = new URLSearchParams(location.search);
const linkedStation = linkedQuery.get("station")?.trim();
const linkedLine = linkedQuery.get("line");
const linkedExit = linkedQuery.get("exit");
if (!staticDemo && linkedStation && linkedStation.length <= 40) {
  const query = /^\d{1,3}$/.test(linkedExit || "")
    ? `${linkedStation}역 ${linkedExit}번 출입구`
    : linkedStation;
  searchStation(query, {
    ground: linkedQuery.get("ground") === "1",
    usable: linkedQuery.get("usable") === "1",
    line: /^[1-9]호선$/.test(linkedLine || "") ? linkedLine : undefined,
  });
}



