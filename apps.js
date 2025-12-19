/* MindUrMind v2 (device-local)
   - Student: logs mood/sleep, journal private, approves parent links
   - Parent: can invite child; sees ONLY linked child high-level trends (no journal)
   - School: aggregated trends by school name (no identities, no journal)
*/

const LS_KEY = "mum_v2_store";

const icons = {
  dash: "▦",
  mood: "☺",
  sleep: "☾",
  journal: "✎",
  links: "⛓",
  insights: "⟠",
  parent: "👪",
  school: "🏫",
  help: "❓",
};

function uid(prefix="id"){
  return `${prefix}_${Math.random().toString(16).slice(2)}_${Date.now().toString(16)}`;
}

function todayISO(){
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth()+1).padStart(2,"0");
  const day = String(d.getDate()).padStart(2,"0");
  return `${y}-${m}-${day}`;
}

function clamp(n,min,max){ return Math.max(min, Math.min(max, n)); }

function loadStore(){
  try{
    const raw = localStorage.getItem(LS_KEY);
    if(!raw) return seedStore();
    const parsed = JSON.parse(raw);
    // mild forward-compat defaults
    parsed.students ||= {};
    parsed.parents ||= {};
    parsed.schools ||= {};
    parsed.links ||= { parentToStudents: {}, pending: [] };
    return parsed;
  }catch{
    return seedStore();
  }
}

function saveStore(store){
  localStorage.setItem(LS_KEY, JSON.stringify(store));
}

function seedStore(){
  const s = {
    version: 2,
    students: {},   // studentId -> {id,email,name,grade,school, createdAt}
    parents: {},    // parentId  -> {id,email,name, createdAt}
    schools: {},    // schoolKey -> {name, createdAt}
    logs: {
      mood: [],     // {studentId, date, mood(1-5), intensity(1-5), cause, note?}
      sleep: [],    // {studentId, date, hours, quality}
      journal: [],  // {studentId, date, text, gratitude}
    },
    links: {
      parentToStudents: {},  // parentId -> [studentId]
      pending: [],           // {id, parentId, parentEmail, studentEmail, createdAt}
    }
  };
  saveStore(s);
  return s;
}

const store = loadStore();

const state = {
  session: null,   // { role, userId, studentId? }
  view: "signin",  // student|parent|school
  page: null,
  charts: [],
};

function mount(){
  const root = document.getElementById("app");
  root.innerHTML = "";
  root.appendChild(renderApp());
}

function renderApp(){
  const wrap = el("div", { className:"wrap" });

  wrap.appendChild(renderTopbar());

  if(!state.session){
    wrap.appendChild(renderAuth());
    return wrap;
  }

  wrap.appendChild(renderShell());
  return wrap;
}

function renderTopbar(){
  const top = el("div", { className:"topbar" });

  const left = el("div", { className:"brand" },
    el("div", { className:"logo", title:"MindUrMind" }),
    el("div", {},
      el("h1", {}, "MindUrMind"),
      el("p", {}, "Wellbeing • Study Routines • Healthy Habits")
    )
  );

  const right = el("div", { className:"actions" });

  if(!state.session){
    right.appendChild(el("span",{className:"pill"}, "Signed out"));
  }else{
    const who = sessionLabel();
    right.appendChild(el("span",{className:"pill"}, who));
    right.appendChild(el("button",{className:"btn", onclick: signOut}, "Sign out"));
  }

  top.appendChild(left);
  top.appendChild(right);
  return top;
}

function renderAuth(){
  const card = el("div", { className:"card", style:"margin-top:16px; padding:18px;" });

  card.appendChild(el("h3",{}, "Sign in"));
  card.appendChild(el("p",{}, "Select your role to continue. Data stays on this device."));

  const roleRow = el("div", { className:"row", style:"margin-top:12px" });

  const btnStudent = el("button",{className:`btn ${state.view==="student"?"primary":""}`, onclick:()=>setView("student")}, "Student");
  const btnParent  = el("button",{className:`btn ${state.view==="parent"?"primary":""}`,  onclick:()=>setView("parent")}, "Parent");
  const btnSchool  = el("button",{className:`btn ${state.view==="school"?"primary":""}`,  onclick:()=>setView("school")}, "School");

  roleRow.append(btnStudent, btnParent, btnSchool);
  card.appendChild(roleRow);

  card.appendChild(el("div",{className:"hr"}));

  if(state.view==="student") card.appendChild(renderStudentSignIn());
  if(state.view==="parent") card.appendChild(renderParentSignIn());
  if(state.view==="school") card.appendChild(renderSchoolSignIn());

  return card;
}

function renderStudentSignIn(){
  const box = el("div", { className:"grid", style:"gap:10px" });

  const email = input("Student email", "email");
  const name  = input("Name");
  const grade = select("Grade", ["Grade 4","Grade 5","Grade 6","Grade 7","Grade 8","Grade 9","Grade 10","Grade 11","Grade 12"]);
  const school = input("School name (required)");

  const note = el("div",{className:"notice"},
    el("div",{}, "Privacy: journal notes remain private to the student."),
    el("div",{}, "Parent & School only see aggregated trends (no journal text).")
  );

  const cta = el("div",{className:"row"},
    el("button",{className:"btn primary", onclick:()=>{
      const e = email.value.trim().toLowerCase();
      const n = name.value.trim();
      const g = grade.value;
      const sc = school.value.trim();
      if(!e || !n || !g || !sc) return alert("Please fill email, name, grade, and school name.");
      signInStudent({email:e,name:n,grade:g,school:sc});
    }}, "Continue")
  );

  box.append(email, name, grade, school, note, cta);
  return box;
}

function renderParentSignIn(){
  const box = el("div",{className:"grid", style:"gap:10px"});
  const email = input("Parent email", "email");
  const name = input("Name (optional)");

  const note = el("div",{className:"notice"},
    el("div",{}, "Parents can link only to a child who approves the request."),
    el("div",{}, "Parents see high-level trends only (no journal text).")
  );

  const cta = el("div",{className:"row"},
    el("button",{className:"btn primary", onclick:()=>{
      const e = email.value.trim().toLowerCase();
      if(!e) return alert("Enter a parent email.");
      signInParent({email:e,name:name.value.trim()});
    }}, "Continue")
  );

  box.append(email, name, note, cta);
  return box;
}

function renderSchoolSignIn(){
  const box = el("div",{className:"grid", style:"gap:10px"});
  const email = input("School email", "email");
  const school = input("School name (must match student entries)");

  const note = el("div",{className:"notice"},
    el("div",{}, "School view is aggregated only — no student identities."),
    el("div",{}, "Make sure the school name matches what students enter.")
  );

  const cta = el("div",{className:"row"},
    el("button",{className:"btn primary", onclick:()=>{
      const e = email.value.trim().toLowerCase();
      const sc = school.value.trim();
      if(!e || !sc) return alert("Enter a school email and school name.");
      signInSchool({email:e, school:sc});
    }}, "Continue")
  );

  box.append(email, school, note, cta);
  return box;
}

function renderShell(){
  // stop & cleanup any previous charts before re-render
  destroyCharts();

  const shell = el("div", { className:"shell" });

  shell.appendChild(renderSidebar());
  shell.appendChild(renderMain());

  return shell;
}

function renderSidebar(){
  const side = el("div", { className:"sidebar" });

  const head = el("div", { className:"sidehead" },
    el("div",{style:"font-weight:800;"}, "Workspace"),
    el("div",{className:"who"}, sessionLabel(true))
  );

  const nav = el("div", { className:"nav" });
  const items = navItemsForRole();

  items.forEach(item=>{
    nav.appendChild(
      el("button",{
        className: state.page===item.key ? "active" : "",
        onclick: ()=>{ state.page = item.key; mount(); }
      },
      el("span",{className:"ico"}, item.ico),
      el("span",{}, item.label)
      )
    );
  });

  side.append(head, nav);
  return side;
}

function renderMain(){
  const main = el("div", { className:"main" });

  const { title, subtitle } = pageHeader();
  main.appendChild(
    el("div",{className:"mainhead"},
      el("div",{},
        el("h2",{}, title),
        el("div",{className:"sub"}, subtitle)
      ),
      el("div",{className:"row", style:"justify-content:flex-end; max-width:320px"},
        ...(roleActions())
      )
    )
  );

  const content = el("div",{className:"content"});
  content.appendChild(renderPage());
  main.appendChild(content);

  // post-render charts
  setTimeout(renderChartsIfAny, 0);

  return main;
}

function navItemsForRole(){
  const role = state.session.role;
  if(role==="student"){
    return [
      { key:"dash", label:"Dashboard", ico:icons.dash },
      { key:"mood", label:"Mood check-in", ico:icons.mood },
      { key:"sleep", label:"Sleep", ico:icons.sleep },
      { key:"journal", label:"Journal", ico:icons.journal },
      { key:"links", label:"Parent access", ico:icons.links },
      { key:"insights", label:"Insights", ico:icons.insights },
      { key:"help", label:"Help", ico:icons.help },
    ];
  }
  if(role==="parent"){
    return [
      { key:"parent_dash", label:"My child", ico:icons.parent },
      { key:"parent_link", label:"Add child", ico:icons.links },
      { key:"help_parent", label:"Tips", ico:icons.help },
    ];
  }
  // school
  return [
    { key:"school_dash", label:"Insights", ico:icons.school },
    { key:"school_actions", label:"Recommended actions", ico:icons.insights },
    { key:"help_school", label:"Support guidance", ico:icons.help },
  ];
}

function roleActions(){
  const role = state.session.role;
  const actions = [];
  if(role==="student"){
    actions.push(el("span",{className:"badge"}, `Grade: ${currentStudent().grade}`));
    actions.push(el("span",{className:"badge"}, `School: ${currentStudent().school}`));
  }
  if(role==="parent"){
    const linked = linkedStudentIdsForParent(state.session.userId);
    actions.push(el("span",{className:"badge"}, `Linked: ${linked.length}`));
  }
  if(role==="school"){
    actions.push(el("span",{className:"badge"}, `School: ${state.session.schoolName}`));
  }
  return actions;
}

function pageHeader(){
  const role = state.session.role;
  const page = state.page || defaultPageForRole(role);

  if(role==="student"){
    const st = currentStudent();
    if(page==="dash") return { title:`Hi, ${st.name.split(" ")[0]} 👋`, subtitle:"Small steps build strong minds." };
    if(page==="mood") return { title:"Mood check-in", subtitle:"Log how you feel. Notes stay private." };
    if(page==="sleep") return { title:"Sleep & energy", subtitle:"Track sleep and patterns over time." };
    if(page==="journal") return { title:"Private journal", subtitle:"Your safe space. Not visible to parents/school." };
    if(page==="links") return { title:"Parent access", subtitle:"Approve or decline parent requests." };
    if(page==="insights") return { title:"Insights", subtitle:"Your trends from recent logs." };
    if(page==="help") return { title:"Help", subtitle:"Tools and tips for stress, focus, and emotions." };
  }

  if(role==="parent"){
    if(page==="parent_dash") return { title:"Child wellbeing snapshot", subtitle:"High-level trends only (no journal text)." };
    if(page==="parent_link") return { title:"Add child", subtitle:"Send a request. Child must approve." };
    if(page==="help_parent") return { title:"Parent tips", subtitle:"Simple, practical support ideas." };
  }

  if(role==="school"){
    if(page==="school_dash") return { title:"School insights", subtitle:"Aggregated trends only — no identities." };
    if(page==="school_actions") return { title:"Recommended actions", subtitle:"Ideas based on overall trends." };
    if(page==="help_school") return { title:"Support guidance", subtitle:"How to use insights responsibly." };
  }

  return { title:"MindUrMind", subtitle:"" };
}

function defaultPageForRole(role){
  if(role==="student") return "dash";
  if(role==="parent") return "parent_dash";
  return "school_dash";
}

function renderPage(){
  const role = state.session.role;
  state.page ||= defaultPageForRole(role);

  if(role==="student"){
    if(state.page==="dash") return studentDashboard();
    if(state.page==="mood") return studentMood();
    if(state.page==="sleep") return studentSleep();
    if(state.page==="journal") return studentJournal();
    if(state.page==="links") return studentLinks();
    if(state.page==="insights") return studentInsights();
    if(state.page==="help") return studentHelp();
  }

  if(role==="parent"){
    if(state.page==="parent_dash") return parentDashboard();
    if(state.page==="parent_link") return parentLink();
    if(state.page==="help_parent") return parentHelp();
  }

  // school
  if(state.page==="school_dash") return schoolDashboard();
  if(state.page==="school_actions") return schoolActions();
  if(state.page==="help_school") return schoolHelp();

  return el("div",{}, "Not found.");
}

/* ---------- Student pages ---------- */

function studentDashboard(){
  const st = currentStudent();
  const moodLast = lastMoodForStudent(st.id);
  const sleepLast = lastSleepForStudent(st.id);

  const moodBadge = moodLast ? moodLabel(moodLast.mood) : "—";
  const sleepBadge = sleepLast ? `${sleepLast.hours}h` : "—";

  const top = el("div",{className:"grid cols3"},
    kpiCard("Mood", moodBadge, "Latest check-in"),
    kpiCard("Sleep", sleepBadge, "Last logged night"),
    kpiCard("Progress", String(totalLogsForStudent(st.id)), "Total logs (mood + sleep)")
  );

  const quick = el("div",{className:"grid cols2", style:"margin-top:12px"},
    actionCard("Mood check-in", "Log feelings and get a coping suggestion.", "Go", ()=>{state.page="mood"; mount();}),
    actionCard("Log sleep", "Track hours + quality for better routines.", "Go", ()=>{state.page="sleep"; mount();})
  );

  const note = el("div",{className:"notice", style:"margin-top:12px"},
    "Reminder: If you feel unsafe or think you might harm yourself, stop and tell a trusted adult immediately."
  );

  return el("div",{}, top, quick, note);
}

function studentMood(){
  const st = currentStudent();

  const wrap = el("div",{className:"grid", style:"gap:12px"});

  const mood = select("Mood (1–5)", ["1","2","3","4","5"]);
  mood.value = "3";
  const intensity = select("Intensity (1–5)", ["1","2","3","4","5"]);
  intensity.value = "3";
  const cause = select("Cause (category)", [
    "Choose…",
    "Exams / homework",
    "Friendship / peer pressure",
    "Family",
    "Health / tired",
    "Sports / activities",
    "Online / social media",
    "Other"
  ]);
  const note = textarea("Optional note (private)");
  const row = el("div",{className:"row"},
    el("button",{className:"btn primary", onclick:()=>{
      const m = Number(mood.value);
      const it = Number(intensity.value);
      const c = (cause.value==="Choose…") ? "" : cause.value;
      store.logs.mood.push({
        studentId: st.id,
        date: todayISO(),
        mood: clamp(m,1,5),
        intensity: clamp(it,1,5),
        cause: c,
        note: note.value.trim()
      });
      saveStore(store);
      alert("Saved mood ✔");
      mount();
    }}, "Save mood"),
    el("button",{className:"btn", onclick:()=>{
      alert(copingSuggestion(Number(mood.value)));
    }}, "Suggestion")
  );

  const last = lastMoodForStudent(st.id);
  const lastCard = el("div",{className:"card"},
    el("h3",{}, "Last entry"),
    el("p",{}, last ? `${last.date} • Mood ${last.mood}/5 • Intensity ${last.intensity}/5 ${last.cause?`• ${last.cause}`:""}` : "No mood entries yet.")
  );

  wrap.append(
    el("div",{className:"card"},
      el("h3",{}, "Mood check-in"),
      el("p",{}, "Pick what matches right now. Notes are optional and private."),
      el("div",{className:"hr"}),
      el("div",{className:"grid cols2"}, mood, intensity),
      cause,
      note,
      row
    ),
    lastCard
  );

  return wrap;
}

function studentSleep(){
  const st = currentStudent();
  const wrap = el("div",{className:"grid", style:"gap:12px"});

  const hours = input("Hours slept last night (e.g., 7.5)", "number");
  hours.step = "0.5";
  hours.min = "0";
  hours.max = "16";

  const quality = select("Sleep quality", ["Great","Okay","Not good"]);
  const row = el("div",{className:"row"},
    el("button",{className:"btn primary", onclick:()=>{
      const h = Number(hours.value);
      if(!hours.value || Number.isNaN(h)) return alert("Enter hours slept.");
      store.logs.sleep.push({
        studentId: st.id,
        date: todayISO(),
        hours: clamp(Math.round(h*10)/10, 0, 16),
        quality: quality.value
      });
      saveStore(store);
      alert("Saved sleep ✔");
      mount();
    }}, "Save sleep")
  );

  const last = lastSleepForStudent(st.id);
  wrap.append(
    el("div",{className:"card"},
      el("h3",{}, "Sleep tracker"),
      el("p",{}, "Log sleep consistently to see patterns."),
      el("div",{className:"hr"}),
      el("div",{className:"grid cols2"}, hours, quality),
      row
    ),
    el("div",{className:"card"},
      el("h3",{}, "Last entry"),
      el("p",{}, last ? `${last.date} • ${last.hours}h • ${last.quality}` : "No sleep entries yet.")
    )
  );
  return wrap;
}

function studentJournal(){
  const st = currentStudent();

  const box = el("div",{className:"grid", style:"gap:12px"});

  const text = textarea("Journal entry (private)");
  const gratitude = input("1 gratitude line (optional)");
  const row = el("div",{className:"row"},
    el("button",{className:"btn primary", onclick:()=>{
      if(!text.value.trim() && !gratitude.value.trim()) return alert("Write something to save.");
      store.logs.journal.unshift({
        studentId: st.id,
        date: todayISO(),
        text: text.value.trim(),
        gratitude: gratitude.value.trim()
      });
      saveStore(store);
      text.value = "";
      gratitude.value = "";
      alert("Saved ✔");
      mount();
    }}, "Save")
  );

  const entries = store.logs.journal.filter(j=>j.studentId===st.id).slice(0,10);

  const list = el("div",{className:"card"},
    el("h3",{}, "Recent entries"),
    el("p",{}, "Only visible in your student account.")
  );
  list.appendChild(el("div",{className:"hr"}));
  if(entries.length===0){
    list.appendChild(el("p",{className:"small"}, "No entries yet."));
  }else{
    entries.forEach(e=>{
      list.appendChild(
        el("div",{style:"padding:10px 0; border-bottom:1px solid var(--line)"},
          el("div",{style:"display:flex; gap:10px; justify-content:space-between; align-items:flex-start"},
            el("div",{style:"font-weight:700; font-size:12px"}, e.date),
            el("span",{className:"badge"}, e.gratitude ? "Gratitude ✓" : "Entry")
          ),
          e.text ? el("div",{className:"small", style:"margin-top:6px; white-space:pre-wrap"}, safeText(e.text)) : null,
          e.gratitude ? el("div",{className:"small", style:"margin-top:6px"}, `🙏 ${safeText(e.gratitude)}`) : null
        )
      );
    });
    // remove last border
    list.lastChild.style.borderBottom = "none";
  }

  box.append(
    el("div",{className:"card"},
      el("h3",{}, "Journal"),
      el("p",{}, "Private space for thoughts. Parents and School cannot access this content."),
      el("div",{className:"hr"}),
      text,
      gratitude,
      row
    ),
    list
  );

  return box;
}

function studentLinks(){
  const st = currentStudent();

  const pending = store.links.pending.filter(p=>p.studentEmail===st.email);
  const linkedParents = Object.entries(store.links.parentToStudents)
    .filter(([pid, arr])=> (arr||[]).includes(st.id))
    .map(([pid])=> store.parents[pid]?.email || pid);

  const card = el("div",{className:"grid", style:"gap:12px"});

  const pendingCard = el("div",{className:"card"},
    el("h3",{}, "Pending requests"),
    el("p",{}, "Approve only if you want this parent to see your high-level trends.")
  );
  pendingCard.appendChild(el("div",{className:"hr"}));

  if(pending.length===0){
    pendingCard.appendChild(el("p",{className:"small"}, "No pending requests."));
  }else{
    pending.forEach(req=>{
      pendingCard.appendChild(
        el("div",{className:"card", style:"background: rgba(255,255,255,.02); padding:12px; margin-top:10px"},
          el("div",{style:"display:flex; justify-content:space-between; gap:10px; align-items:center"},
            el("div",{},
              el("div",{style:"font-weight:800; font-size:13px"}, req.parentEmail),
              el("div",{className:"small"}, `Requested on ${req.createdAt.slice(0,10)}`)
            ),
            el("div",{style:"display:flex; gap:8px"},
              el("button",{className:"btn primary", onclick:()=>{
                approveParent(req.id, st.id);
              }}, "Approve"),
              el("button",{className:"btn", onclick:()=>{
                declineParent(req.id);
              }}, "Decline")
            )
          )
        )
      );
    });
  }

  const linkedCard = el("div",{className:"card"},
    el("h3",{}, "Approved parents"),
    el("p",{}, "These parents can view your trends only.")
  );
  linkedCard.appendChild(el("div",{className:"hr"}));
  if(linkedParents.length===0){
    linkedCard.appendChild(el("p",{className:"small"}, "No parents linked yet."));
  }else{
    linkedParents.forEach(e=>{
      linkedCard.appendChild(el("div",{className:"small", style:"padding:6px 0"}, `• ${e}`));
    });
  }

  card.append(pendingCard, linkedCard);
  return card;
}

function studentInsights(){
  const st = currentStudent();
  const moods = store.logs.mood.filter(m=>m.studentId===st.id).slice(-7);
  const sleeps = store.logs.sleep.filter(s=>s.studentId===st.id).slice(-7);

  const grid = el("div",{className:"grid cols2"});

  const moodCard = el("div",{className:"card"},
    el("h3",{}, "Mood trend (last 7)"),
    el("p",{}, moods.length ? "Your recent mood scores." : "Log moods to see a trend."),
    el("div",{className:"hr"}),
    el("canvas",{id:"chart_student_mood", height:"120"})
  );

  const sleepCard = el("div",{className:"card"},
    el("h3",{}, "Sleep trend (last 7)"),
    el("p",{}, sleeps.length ? "Your recent sleep hours." : "Log sleep to see a trend."),
    el("div",{className:"hr"}),
    el("canvas",{id:"chart_student_sleep", height:"120"})
  );

  // register chart configs
  state.charts = [
    {
      id:"chart_student_mood",
      type:"line",
      data: {
        labels: moods.map(x=>x.date.slice(5)),
        datasets: [{ label:"Mood (1–5)", data: moods.map(x=>x.mood) }]
      },
      options: axisOptions(1,5)
    },
    {
      id:"chart_student_sleep",
      type:"line",
      data: {
        labels: sleeps.map(x=>x.date.slice(5)),
        datasets: [{ label:"Sleep (hours)", data: sleeps.map(x=>x.hours) }]
      },
      options: axisOptions(0,12)
    }
  ];

  grid.append(moodCard, sleepCard);

  const prog = el("div",{className:"card", style:"margin-top:12px"},
    el("h3",{}, "Progress"),
    el("div",{className:"hr"}),
    el("div",{className:"grid cols3"},
      kpiCard("Mood logs", String(moods.length), "Last 7 window"),
      kpiCard("Sleep logs", String(sleeps.length), "Last 7 window"),
      kpiCard("Journal entries", String(store.logs.journal.filter(j=>j.studentId===st.id).length), "Private")
    )
  );

  return el("div",{}, grid, prog);
}

function studentHelp(){
  // Keep it non-AI; simple structured help
  return el("div",{className:"grid cols2"},
    el("div",{className:"card"},
      el("h3",{}, "Quick calm tools"),
      el("p",{}, "Try one tool for 60 seconds."),
      el("div",{className:"hr"}),
      el("div",{className:"row"},
        el("button",{className:"btn", onclick:()=>alert("Box breathing: Inhale 4 • Hold 4 • Exhale 4 • Hold 4. Repeat 4 times.")}, "Box breathing"),
        el("button",{className:"btn", onclick:()=>alert("5-4-3-2-1: 5 things you see • 4 you feel • 3 you hear • 2 you smell • 1 you taste.")}, "5-4-3-2-1")
      )
    ),
    el("div",{className:"card"},
      el("h3",{}, "Study stress reset"),
      el("p",{}, "Small steps reduce panic."),
      el("div",{className:"hr"}),
      el("p",{className:"small"},
        "1) Write the next tiny task (5 minutes).\n" +
        "2) Start a timer.\n" +
        "3) When done, take a short break.\n" +
        "4) Repeat.\n"
      )
    )
  );
}

/* ---------- Parent pages ---------- */

function parentDashboard(){
  const parentId = state.session.userId;
  const linkedIds = linkedStudentIdsForParent(parentId);

  if(linkedIds.length===0){
    return el("div",{className:"card"},
      el("h3",{}, "No child linked yet"),
      el("p",{}, "Go to “Add child” to send a request. The student must approve it."),
      el("div",{className:"hr"}),
      el("button",{className:"btn primary", onclick:()=>{state.page="parent_link"; mount();}}, "Add child")
    );
  }

  // If multiple linked, show selector
  const selected = state.session.studentId || linkedIds[0];
  state.session.studentId = selected;

  const student = store.students[selected];
  if(!student){
    return el("div",{className:"card"},
      el("h3",{}, "Linked student not found"),
      el("p",{}, "This can happen if local storage was cleared.")
    );
  }

  const moods = store.logs.mood.filter(m=>m.studentId===student.id).slice(-14);
  const sleeps = store.logs.sleep.filter(s=>s.studentId===student.id).slice(-14);

  const avgMood = moods.length ? (moods.reduce((a,b)=>a+b.mood,0)/moods.length) : null;
  const avgSleep = sleeps.length ? (sleeps.reduce((a,b)=>a+b.hours,0)/sleeps.length) : null;

  const trendBadge = avgMood==null ? ["—","badge"] : avgMood>=4 ? ["Doing well","badge good"] : avgMood>=3 ? ["Okay","badge warn"] : ["Needs support","badge bad"];

  const chooser = el("div",{className:"card"},
    el("h3",{}, "Select child"),
    el("div",{className:"hr"})
  );
  const sel = el("select",{});
  linkedIds.forEach(id=>{
    const s = store.students[id];
    if(!s) return;
    const opt = document.createElement("option");
    opt.value = id;
    opt.textContent = `${s.name} (${s.grade})`;
    if(id===selected) opt.selected = true;
    sel.appendChild(opt);
  });
  sel.onchange = ()=>{ state.session.studentId = sel.value; mount(); };
  chooser.appendChild(sel);

  const grid = el("div",{className:"grid cols3", style:"margin-top:12px"},
    kpiCard("Mood status", trendBadge[0], "Based on recent check-ins", trendBadge[1]),
    kpiCard("Avg mood", avgMood==null ? "—" : avgMood.toFixed(1), "Last 14 entries"),
    kpiCard("Avg sleep", avgSleep==null ? "—" : `${avgSleep.toFixed(1)}h`, "Last 14 entries")
  );

  const charts = el("div",{className:"grid cols2", style:"margin-top:12px"},
    el("div",{className:"card"},
      el("h3",{}, "Mood trend (no notes)"),
      el("p",{}, "Only scores and categories, not journal content."),
      el("div",{className:"hr"}),
      el("canvas",{id:"chart_parent_mood", height:"120"})
    ),
    el("div",{className:"card"},
      el("h3",{}, "Sleep trend"),
      el("p",{}, "Hours and quality only."),
      el("div",{className:"hr"}),
      el("canvas",{id:"chart_parent_sleep", height:"120"})
    )
  );

  state.charts = [
    {
      id:"chart_parent_mood",
      type:"line",
      data:{
        labels: moods.slice(-10).map(x=>x.date.slice(5)),
        datasets:[{label:"Mood (1–5)", data: moods.slice(-10).map(x=>x.mood)}]
      },
      options: axisOptions(1,5)
    },
    {
      id:"chart_parent_sleep",
      type:"line",
      data:{
        labels: sleeps.slice(-10).map(x=>x.date.slice(5)),
        datasets:[{label:"Sleep (hours)", data: sleeps.slice(-10).map(x=>x.hours)}]
      },
      options: axisOptions(0,12)
    }
  ];

  const categories = moodCategoryCounts(student.id, 20);
  const catCard = el("div",{className:"card", style:"margin-top:12px"},
    el("h3",{}, "Top mood causes (categories)"),
    el("p",{}, "Categories help spot patterns. No personal notes are shown."),
    el("div",{className:"hr"})
  );
  if(Object.keys(categories).length===0){
    catCard.appendChild(el("p",{className:"small"}, "No category data yet."));
  }else{
    const rows = Object.entries(categories).sort((a,b)=>b[1]-a[1]).slice(0,6);
    const t = el("table",{className:"table"});
    t.appendChild(el("tr",{},
      el("th",{}, "Category"),
      el("th",{}, "Count")
    ));
    rows.forEach(([k,v])=>{
      t.appendChild(el("tr",{},
        el("td",{}, k),
        el("td",{}, String(v))
      ));
    });
    catCard.appendChild(t);
  }

  const tips = el("div",{className:"card", style:"margin-top:12px"},
    el("h3",{}, "Simple support routine"),
    el("p",{}, "Small, consistent support works better than big talks."),
    el("div",{className:"hr"}),
    el("div",{className:"small"},
      "• Ask one calm question: “What was the hardest part of today?”\n" +
      "• Notice effort, not only grades.\n" +
      "• Protect sleep: consistent bedtime, less late-night screen.\n" +
      "• Encourage micro-steps: 10 minutes is better than zero.\n"
    )
  );

  return el("div",{}, chooser, grid, charts, catCard, tips);
}

function parentLink(){
  const parentId = state.session.userId;

  const studentEmail = input("Child (student) email", "email");
  const sendBtn = el("button",{className:"btn primary", onclick:()=>{
    const e = studentEmail.value.trim().toLowerCase();
    if(!e) return alert("Enter the student email.");
    const already = store.links.pending.some(p=>p.parentId===parentId && p.studentEmail===e);
    if(already) return alert("Request already pending for this student.");
    store.links.pending.push({
      id: uid("req"),
      parentId,
      parentEmail: store.parents[parentId].email,
      studentEmail: e,
      createdAt: new Date().toISOString()
    });
    saveStore(store);
    studentEmail.value = "";
    alert("Request sent ✔ (Student must approve in their account)");
    mount();
  }}, "Send request");

  const pending = store.links.pending.filter(p=>p.parentId===parentId);

  const pendingCard = el("div",{className:"card", style:"margin-top:12px"},
    el("h3",{}, "Pending requests"),
    el("p",{}, "The student must approve before you can view anything."),
    el("div",{className:"hr"})
  );
  if(pending.length===0){
    pendingCard.appendChild(el("p",{className:"small"}, "No pending requests."));
  }else{
    const t = el("table",{className:"table"});
    t.appendChild(el("tr",{},
      el("th",{}, "Student email"),
      el("th",{}, "Requested"),
      el("th",{}, "Action")
    ));
    pending.forEach(p=>{
      const tr = el("tr",{},
        el("td",{}, p.studentEmail),
        el("td",{}, p.createdAt.slice(0,10)),
        el("td",{},
          el("button",{className:"btn", onclick:()=>{
            store.links.pending = store.links.pending.filter(x=>x.id!==p.id);
            saveStore(store);
            mount();
          }}, "Cancel")
        )
      );
      t.appendChild(tr);
    });
    pendingCard.appendChild(t);
  }

  const linked = linkedStudentIdsForParent(parentId).map(id=>store.students[id]).filter(Boolean);

  const linkedCard = el("div",{className:"card", style:"margin-top:12px"},
    el("h3",{}, "Linked children"),
    el("p",{}, "You can view trends for these children only."),
    el("div",{className:"hr"})
  );
  if(linked.length===0){
    linkedCard.appendChild(el("p",{className:"small"}, "No linked children yet."));
  }else{
    const t = el("table",{className:"table"});
    t.appendChild(el("tr",{},
      el("th",{}, "Name"),
      el("th",{}, "Grade"),
      el("th",{}, "School"),
      el("th",{}, "Access")
    ));
    linked.forEach(s=>{
      t.appendChild(el("tr",{},
        el("td",{}, s.name),
        el("td",{}, s.grade),
        el("td",{}, s.school),
        el("td",{},
          el("button",{className:"btn", onclick:()=>{
            state.session.studentId = s.id;
            state.page = "parent_dash";
            mount();
          }}, "View")
        )
      ));
    });
    linkedCard.appendChild(t);
  }

  return el("div",{},
    el("div",{className:"card"},
      el("h3",{}, "Add child"),
      el("p",{}, "Enter the student’s email. The student will see the request and can approve it."),
      el("div",{className:"hr"}),
      el("div",{className:"row"}, studentEmail, sendBtn),
      el("div",{className:"small", style:"margin-top:8px"},
        "Device-local note: Parent and Student must use the same browser/device storage for linking."
      )
    ),
    pendingCard,
    linkedCard
  );
}

function parentHelp(){
  return el("div",{className:"grid cols2"},
    el("div",{className:"card"},
      el("h3",{}, "Conversation starters"),
      el("p",{}, "Short, calm questions work best."),
      el("div",{className:"hr"}),
      el("div",{className:"small"},
        "• “What was one good moment today?”\n" +
        "• “What felt stressful?”\n" +
        "• “What’s one tiny thing I can help with?”\n" +
        "• “Do you want advice, or just listening?”\n"
      )
    ),
    el("div",{className:"card"},
      el("h3",{}, "When to escalate"),
      el("p",{}, "If you suspect the child is unsafe."),
      el("div",{className:"hr"}),
      el("div",{className:"small"},
        "If you think there is risk of self-harm or immediate danger:\n" +
        "• Stay with them, contact a trusted adult/support pathway.\n" +
        "• Call local emergency services or a local crisis line.\n" +
        "• Seek professional help.\n"
      )
    )
  );
}

/* ---------- School pages ---------- */

function schoolDashboard(){
  const schoolName = state.session.schoolName;
  const studentIds = Object.values(store.students).filter(s=>s.school===schoolName).map(s=>s.id);

  const moods = store.logs.mood.filter(m=>studentIds.includes(m.studentId)).slice(-200);
  const sleeps = store.logs.sleep.filter(s=>studentIds.includes(s.studentId)).slice(-200);

  const studentsCount = studentIds.length;
  const moodCount = moods.length;
  const sleepAvg = sleeps.length ? (sleeps.reduce((a,b)=>a+b.hours,0)/sleeps.length) : null;

  // Mood distribution (counts by mood score)
  const dist = {1:0,2:0,3:0,4:0,5:0};
  moods.forEach(m=>{ dist[m.mood] = (dist[m.mood]||0)+1; });

  state.charts = [
    {
      id:"chart_school_mood_dist",
      type:"bar",
      data:{
        labels:["1","2","3","4","5"],
        datasets:[{label:"Mood check-ins", data:[dist[1],dist[2],dist[3],dist[4],dist[5]]}]
      },
      options:{
        responsive:true,
        scales:{ y:{ beginAtZero:true } }
      }
    },
    {
      id:"chart_school_sleep",
      type:"line",
      data:{
        labels: lastNDatesFromLogs(sleeps, 10),
        datasets:[{label:"Avg sleep (hours)", data: avgSleepByDate(sleeps, 10)}]
      },
      options: axisOptions(0,12)
    }
  ];

  const grid = el("div",{className:"grid cols3"},
    kpiCard("Students (device-local)", String(studentsCount), "Students who entered this school name"),
    kpiCard("Mood check-ins", String(moodCount), "Recent entries"),
    kpiCard("Avg sleep", sleepAvg==null ? "—" : `${sleepAvg.toFixed(1)}h`, "Across recent logs")
  );

  const charts = el("div",{className:"grid cols2", style:"margin-top:12px"},
    el("div",{className:"card"},
      el("h3",{}, "Mood distribution (aggregated)"),
      el("p",{}, "Counts only. No identities."),
      el("div",{className:"hr"}),
      el("canvas",{id:"chart_school_mood_dist", height:"120"})
    ),
    el("div",{className:"card"},
      el("h3",{}, "Sleep trend (aggregated)"),
      el("p",{}, "Average sleep per day from logs."),
      el("div",{className:"hr"}),
      el("canvas",{id:"chart_school_sleep", height:"120"})
    )
  );

  const categories = moodCategoryCountsForStudentIds(studentIds, 200);
  const catCard = el("div",{className:"card", style:"margin-top:12px"},
    el("h3",{}, "Top stress themes (categories)"),
    el("p",{}, "Category counts only. No personal notes."),
    el("div",{className:"hr"})
  );

  if(Object.keys(categories).length===0){
    catCard.appendChild(el("p",{className:"small"}, "No category data yet."));
  }else{
    const rows = Object.entries(categories).sort((a,b)=>b[1]-a[1]).slice(0,8);
    const t = el("table",{className:"table"});
    t.appendChild(el("tr",{},
      el("th",{}, "Theme"),
      el("th",{}, "Count")
    ));
    rows.forEach(([k,v])=>{
      t.appendChild(el("tr",{}, el("td",{}, k), el("td",{}, String(v))));
    });
    catCard.appendChild(t);
  }

  return el("div",{},
    grid,
    charts,
    catCard,
    el("div",{className:"notice", style:"margin-top:12px"},
      "Use aggregated insights to plan wellbeing supports — not to monitor individuals."
    )
  );
}

function schoolActions(){
  const schoolName = state.session.schoolName;
  const studentIds = Object.values(store.students).filter(s=>s.school===schoolName).map(s=>s.id);
  const categories = moodCategoryCountsForStudentIds(studentIds, 200);

  const sorted = Object.entries(categories).sort((a,b)=>b[1]-a[1]);
  const top = sorted[0]?.[0] || null;

  const actions = [];

  if(!top){
    actions.push("Collect more anonymous check-ins to see patterns.");
  }else{
    if(top.includes("Exams")) actions.push("Coordinate assessment calendar; run study skills + time management session.");
    if(top.includes("Friendship")) actions.push("Peer support + anti-bullying activities + empathy scenario game day.");
    if(top.includes("Online")) actions.push("Healthy screen habits week; teach digital wellbeing boundaries.");
    if(top.includes("Family")) actions.push("Offer parent workshop: communication + routine building.");
    if(top.includes("Health")) actions.push("Promote sleep, hydration, and movement micro-breaks in classes.");
    if(top.includes("Sports")) actions.push("Balance training loads; include recovery + mindset sessions.");
    if(top.includes("Other")) actions.push("Run an anonymous ‘What stresses you most?’ poll (no identities).");
  }

  actions.push("Offer a 60-second breathing reset at start of class (opt-in).");
  actions.push("Ensure safe reporting pathways outside the app if needed.");

  return el("div",{className:"card"},
    el("h3",{}, "Recommended actions"),
    el("p",{}, "Ideas based on aggregated categories and trends."),
    el("div",{className:"hr"}),
    el("div",{className:"small"}, actions.map(a=>`• ${a}`).join("\n"))
  );
}

function schoolHelp(){
  return el("div",{className:"grid cols2"},
    el("div",{className:"card"},
      el("h3",{}, "Responsible use"),
      el("p",{}, "Use insights for supportive planning."),
      el("div",{className:"hr"}),
      el("div",{className:"small"},
        "Do:\n" +
        "• Use trends to schedule wellbeing sessions.\n" +
        "• Improve workload planning during high-stress periods.\n" +
        "• Offer opt-in support and resources.\n\n" +
        "Avoid:\n" +
        "• Trying to identify individuals.\n" +
        "• Punitive responses to trends.\n"
      )
    ),
    el("div",{className:"card"},
      el("h3",{}, "If a student seems unsafe"),
      el("p",{}, "Follow your school safeguarding policy."),
      el("div",{className:"hr"}),
      el("div",{className:"small"},
        "If there is immediate risk:\n" +
        "• Contact safeguarding lead / counselor.\n" +
        "• Notify trusted adult pathway.\n" +
        "• Call local emergency services as required.\n"
      )
    )
  );
}

/* ---------- Auth & linking ---------- */

function setView(v){ state.view=v; mount(); }

function signOut(){
  state.session = null;
  state.page = null;
  mount();
}

function signInStudent({email,name,grade,school}){
  // find existing by email
  const existing = Object.values(store.students).find(s=>s.email===email);
  let studentId;
  if(existing){
    existing.name = name;
    existing.grade = grade;
    existing.school = school;
    studentId = existing.id;
  }else{
    studentId = uid("stu");
    store.students[studentId] = {
      id: studentId,
      email,
      name,
      grade,
      school,
      createdAt: new Date().toISOString()
    };
  }
  store.schools[school] ||= { name: school, createdAt: new Date().toISOString() };
  saveStore(store);

  state.session = { role:"student", userId: studentId };
  state.page = "dash";
  mount();
}

function signInParent({email,name}){
  const existing = Object.values(store.parents).find(p=>p.email===email);
  let parentId;
  if(existing){
    existing.name = name || existing.name;
    parentId = existing.id;
  }else{
    parentId = uid("par");
    store.parents[parentId] = { id: parentId, email, name: name||"", createdAt: new Date().toISOString() };
  }
  saveStore(store);

  state.session = { role:"parent", userId: parentId, studentId: null };
  state.page = "parent_dash";
  mount();
}

function signInSchool({email, school}){
  store.schools[school] ||= { name: school, createdAt: new Date().toISOString() };
  saveStore(store);

  state.session = { role:"school", userId: email, schoolName: school };
  state.page = "school_dash";
  mount();
}

function approveParent(reqId, studentId){
  const req = store.links.pending.find(r=>r.id===reqId);
  if(!req) return;

  store.links.pending = store.links.pending.filter(r=>r.id!==reqId);

  const arr = store.links.parentToStudents[req.parentId] || [];
  if(!arr.includes(studentId)) arr.push(studentId);
  store.links.parentToStudents[req.parentId] = arr;

  saveStore(store);
  alert("Approved ✔ Parent can now view your trends.");
  mount();
}

function declineParent(reqId){
  store.links.pending = store.links.pending.filter(r=>r.id!==reqId);
  saveStore(store);
  alert("Declined ✔");
  mount();
}

function linkedStudentIdsForParent(parentId){
  return store.links.parentToStudents[parentId] || [];
}

/* ---------- Utilities / Components ---------- */

function el(tag, props={}, ...children){
  const node = document.createElement(tag);
  for(const [k,v] of Object.entries(props||{})){
    if(k==="className") node.className = v;
    else if(k==="onclick") node.onclick = v;
    else if(k==="style") node.setAttribute("style", v);
    else if(k.startsWith("on") && typeof v==="function") node[k]=v;
    else node.setAttribute(k, v);
  }
  children.flat().filter(Boolean).forEach(ch=>{
    if(typeof ch==="string") node.appendChild(document.createTextNode(ch));
    else node.appendChild(ch);
  });
  return node;
}

function input(placeholder, type="text"){
  const i = el("input",{placeholder, type});
  return i;
}
function textarea(placeholder){
  return el("textarea",{placeholder});
}
function select(label, options){
  const s = el("select",{});
  options.forEach(o=>{
    const opt = document.createElement("option");
    opt.value = o;
    opt.textContent = o;
    s.appendChild(opt);
  });
  s.setAttribute("aria-label", label);
  return s;
}

function kpiCard(label, value, hint, extraClass="badge"){
  const badge = el("span",{className:extraClass}, value);
  return el("div",{className:"card"},
    el("div",{className:"kpi"},
      el("div",{},
        el("div",{className:"label"}, label),
        el("div",{className:"value"}, typeof value==="string" && value.length>7 ? value.slice(0,7) : value)
      ),
      badge
    ),
    el("div",{className:"small", style:"margin-top:10px"}, hint)
  );
}

function actionCard(title, desc, cta, fn){
  return el("div",{className:"card"},
    el("h3",{}, title),
    el("p",{}, desc),
    el("div",{className:"hr"}),
    el("button",{className:"btn primary", onclick:fn}, cta)
  );
}

function currentStudent(){
  return store.students[state.session.userId];
}

function sessionLabel(short=false){
  if(!state.session) return "Signed out";
  const r = state.session.role;
  if(r==="student"){
    const s = currentStudent();
    return short ? `Student • ${s.email}` : `Student • ${s.email}`;
  }
  if(r==="parent"){
    const p = store.parents[state.session.userId];
    return short ? `Parent • ${p.email}` : `Parent • ${p.email}`;
  }
  return short ? `School • ${state.session.userId}` : `School • ${state.session.userId}`;
}

function totalLogsForStudent(studentId){
  const m = store.logs.mood.filter(x=>x.studentId===studentId).length;
  const s = store.logs.sleep.filter(x=>x.studentId===studentId).length;
  return m+s;
}

function lastMoodForStudent(studentId){
  const arr = store.logs.mood.filter(m=>m.studentId===studentId);
  return arr.length ? arr[arr.length-1] : null;
}

function lastSleepForStudent(studentId){
  const arr = store.logs.sleep.filter(s=>s.studentId===studentId);
  return arr.length ? arr[arr.length-1] : null;
}

function moodLabel(m){
  if(m>=5) return "Excellent";
  if(m===4) return "Good";
  if(m===3) return "Okay";
  if(m===2) return "Low";
  return "Very low";
}

function copingSuggestion(mood){
  if(mood>=4) return "Keep the streak: write 1 thing you did well today and repeat it tomorrow.";
  if(mood===3) return "Try: 10 minutes focus on one small task + 60 seconds breathing.";
  if(mood===2) return "Try: drink water, 5-4-3-2-1 grounding, and tell a trusted adult you’re stressed.";
  return "Pause. Breathe slowly for 60 seconds. If you feel unsafe, tell a trusted adult immediately.";
}

function safeText(s){ return s; } // placeholder for any future sanitization

function moodCategoryCounts(studentId, limit=50){
  const logs = store.logs.mood.filter(m=>m.studentId===studentId).slice(-limit);
  const counts = {};
  logs.forEach(l=>{
    if(!l.cause) return;
    counts[l.cause] = (counts[l.cause]||0)+1;
  });
  return counts;
}

function moodCategoryCountsForStudentIds(ids, limit=200){
  const logs = store.logs.mood.filter(m=>ids.includes(m.studentId)).slice(-limit);
  const counts = {};
  logs.forEach(l=>{
    if(!l.cause) return;
    counts[l.cause] = (counts[l.cause]||0)+1;
  });
  return counts;
}

function axisOptions(min, max){
  return {
    responsive:true,
    scales:{
      y:{ beginAtZero:false, suggestedMin:min, suggestedMax:max }
    }
  };
}

/* ---------- Charts lifecycle ---------- */

function destroyCharts(){
  try{
    state.chartsInstances?.forEach(ch=>ch.destroy());
  }catch{}
  state.chartsInstances = [];
  state.charts = [];
}

function renderChartsIfAny(){
  if(!state.charts || state.charts.length===0) return;
  state.chartsInstances = [];
  state.charts.forEach(cfg=>{
    const canvas = document.getElementById(cfg.id);
    if(!canvas) return;
    const ctx = canvas.getContext("2d");
    const chart = new Chart(ctx, {
      type: cfg.type,
      data: cfg.data,
      options: cfg.options || { responsive:true }
    });
    state.chartsInstances.push(chart);
  });
}

/* ---------- School helpers for aggregation ---------- */

function lastNDatesFromLogs(logs, n=10){
  // unique dates, last n, sorted
  const dates = Array.from(new Set(logs.map(l=>l.date))).sort();
  return dates.slice(-n).map(d=>d.slice(5));
}

function avgSleepByDate(logs, n=10){
  const by = {};
  logs.forEach(l=>{
    by[l.date] ||= [];
    by[l.date].push(l.hours);
  });
  const dates = Object.keys(by).sort().slice(-n);
  return dates.map(d=>{
    const arr = by[d];
    return arr.reduce((a,b)=>a+b,0)/arr.length;
  });
}

/* boot */
mount();
