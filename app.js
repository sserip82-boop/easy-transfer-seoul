const departure = document.querySelector("#departure");
const arrival = document.querySelector("#arrival");
const summary = document.querySelector("#summary");
const steps = document.querySelector("#steps");
const transferStation = document.querySelector("#transfer-station");
const liftNotice = document.querySelector("#lift-notice");
const routeEvidence = document.querySelector(".route-evidence");
let routeFacilities = [];

function updateRouteFacilities(facilities) {
  routeFacilities = facilities;
  showRoute();
}

function elevatorNote(route, index) {
  // The CSV identifies the B4–B2 leg, but does not give a facility ID.
  const candidateLeg = transferStation.value === "충무로" && route.from.startsWith("3호선") &&
    route.to === "4호선 동대문역사문화공원 방면" && index === 1 &&
    route.steps[index - 1]?.startsWith("(B4)") && route.steps[index + 1]?.startsWith("(B2)");
  const candidates = candidateLeg ? routeFacilities.filter(facility =>
    facility.code === "0423" && facility.name?.endsWith("3-4호선 내부#3") &&
    facility.floors === "B4 → B2"
  ) : [];
  if (candidates.length !== 1) return "환승 단계에 해당하는 설비 미확인";
  return `층 기준 후보 · 내부 3호기 · 후보 설비 공식 상태 ${candidates[0].state || "미확인"} · 현장 대조 필요`;
}

function setOptions(select, values) {
  select.replaceChildren(...values.map(value => new Option(value, value)));
}

function showRoute() {
  const route = stationRoutes().find(item => item.from === departure.value && item.to === arrival.value);
  if (!route) return;
  const elevators = route.steps.filter(step => step.includes("엘리베이터 탑승")).length;
  const lifts = route.steps.filter(step => /휠체어\s*리프트/.test(step)).length;
  summary.textContent = `${route.steps.length}단계 · 엘리베이터 ${elevators}회${lifts ? ` · 휠체어리프트 ${lifts}회` : ""}`;
  liftNotice.hidden = !lifts;
  steps.replaceChildren(...route.steps.map((text, index) => {
    const item = document.createElement("li");
    item.textContent = text;
    if (text.includes("엘리베이터 탑승")) {
      const note = document.createElement("small");
      note.className = "elevator-note";
      note.textContent = elevatorNote(route, index);
      item.append(note);
    }
    return item;
  }));
}

function showDestinations() {
  const destinations = stationRoutes().filter(route => route.from === departure.value).map(route => route.to);
  setOptions(arrival, destinations.sort((left, right) => left.length - right.length));
  showRoute();
}

function stationRoutes() {
  return { 충무로: routes, 불광: bulgwangRoutes, 신당: sindangRoutes }[transferStation.value];
}

function showStationRoutes() {
  routeEvidence.hidden = transferStation.value !== "충무로";
  setOptions(departure, [...new Set(stationRoutes().map(route => route.from))]);
  showDestinations();
}

transferStation.addEventListener("change", showStationRoutes);
departure.addEventListener("change", showDestinations);
arrival.addEventListener("change", showRoute);
showStationRoutes();
