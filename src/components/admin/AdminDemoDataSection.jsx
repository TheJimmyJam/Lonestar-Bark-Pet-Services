import { useState } from "react";
import { saveClients, saveWalkerProfiles } from "../../supabase.js";

// ─── Demo Data Generator ──────────────────────────────────────────────────────
function buildDemoData() {
  const now = new Date();
  function randomInt(a, b) { return Math.floor(Math.random() * (b - a + 1)) + a; }
  function pick(arr) { return arr[randomInt(0, arr.length - 1)]; }

  // ── 20 Demo Walkers ─────────────────────────────────────────────
  const WALKER_INFO = [
    ["Emma","Torres","emma.torres"],   ["Liam","Parker","liam.parker"],
    ["Olivia","Nguyen","olivia.nguyen"],["Noah","Williams","noah.williams"],
    ["Ava","Johnson","ava.johnson"],    ["Ethan","Brown","ethan.brown"],
    ["Sophia","Davis","sophia.davis"],  ["Mason","Wilson","mason.wilson"],
    ["Isabella","Martinez","isabella.martinez"],["Logan","Anderson","logan.anderson"],
    ["Mia","Taylor","mia.taylor"],      ["Lucas","Thomas","lucas.thomas"],
    ["Charlotte","Jackson","charlotte.jackson"],["Aiden","White","aiden.white"],
    ["Amelia","Harris","amelia.harris"],["Elijah","Martin","elijah.martin"],
    ["Harper","Thompson","harper.thompson"],["James","Garcia","james.garcia"],
    ["Evelyn","Robinson","evelyn.robinson"],["Benjamin","Clark","benjamin.clark"],
  ];
  const WALKER_AVATARS = ["🐕","🦮","🐩","🐾","🌟","⭐","🎯","🏃","🌻","🎪",
                          "🦴","🐶","🌈","🏅","🎖️","🌙","☀️","💫","🎀","🐕‍🦺"];
  const WALKER_COLORS = [
    "#C4541A","#3D6B7A","#5E3D7A","#3D7A5E","#7A5E3D","#3D5E7A","#7A3D5E","#5E7A3D",
    "#6B3D7A","#3D7A6B","#7A6B3D","#3D4A7A","#7A3D4A","#4A7A3D","#6B7A3D","#3D6B4A",
    "#7A4A3D","#4A3D7A","#6B4A7A","#4A7A6B",
  ];
  const WALKER_ROLES = [
    "Dog Walker","Dog Walker","Dog Walker","Senior Walker","Dog Walker",
    "Cat Sitter","Dog Walker","Dog Walker","Senior Walker","Dog Walker",
    "Dog Walker","Dog Walker","Cat Sitter","Dog Walker","Senior Walker",
    "Dog Walker","Dog Walker","Dog Walker","Dog Walker","Dog Walker",
  ];
  const WALKER_BIOS = [
    "Lifelong animal lover with a passion for keeping pets happy and active. Certified in pet first aid.",
    "Former veterinary technician turned professional dog walker. Specializes in high-energy breeds.",
    "Grew up on a farm surrounded by animals. Loves long walks and building trust with every pet.",
    "Marathon runner who brings the same energy to every walk. Dogs love to keep up!",
    "Cat whisperer and dog enthusiast. Gentle, patient, and always on time.",
    "3 years of professional pet care experience in the Dallas area. Vetted and insured.",
    "Passionate about animal welfare and positive reinforcement training techniques.",
    "Retired teacher who now spends every day with the best students — dogs and cats.",
    "Nature lover who treats every walk like a mini adventure for your furry friend.",
    "Certified pet sitter with experience in senior dog care and puppy socialization.",
    "Full-time walker who takes pride in detailed pet reports and photo updates.",
    "Animal behaviorist background. Excellent with anxious or reactive dogs.",
    "Dog mom of three who extends that same love to every client's pet.",
    "Former shelter volunteer with a soft spot for rescue animals of all kinds.",
    "Energetic and reliable — your dog's favorite part of the day.",
    "Specializes in multi-pet households and cats who need extra patience.",
    "Weekend hiker and weekday dog walker. Keeps pets active year-round.",
    "Professional pet care provider serving East Dallas and surrounding areas.",
    "Dedicated to giving every pet the individual attention they deserve.",
    "Friendly, punctual, and great at following each pet's unique routine.",
  ];
  const WALKER_SERVICES = [
    ["dog-30","dog-60"],["dog-30","dog-60","cat-sitting"],["dog-30"],
    ["dog-60","cat-sitting","overnight"],["dog-30","dog-60","overnight"],
    ["cat-sitting","overnight"],["dog-30","dog-60","cat-sitting","overnight"],
    ["dog-30","cat-sitting"],
  ];
  const AREA_CODES = ["214","469","972"];
  const STREETS = [
    ["McKinney Ave","75204"],["Cole Ave","75204"],["Oak Lawn Ave","75219"],
    ["Lemmon Ave","75219"],["Greenville Ave","75206"],["Mockingbird Ln","75214"],
    ["Skillman St","75206"],["Abrams Rd","75214"],["Gaston Ave","75214"],
    ["Henderson Ave","75206"],["Ross Ave","75204"],["Bryan St","75204"],
    ["Commerce St","75226"],["Elm St","75226"],["Main St","75202"],
    ["Jefferson Blvd","75208"],["Davis St","75208"],["Bishop Ave","75208"],
    ["Colorado Blvd","75208"],["Lovers Ln","75225"],["Hillcrest Rd","75225"],
    ["University Blvd","75205"],["Armstrong Pkwy","75205"],["Beverly Dr","75205"],
    ["Preston Rd","75230"],["Royal Ln","75229"],["Forest Ln","75230"],
    ["Campbell Rd","75248"],["Arapaho Rd","75248"],["Belt Line Rd","75248"],
    ["Marsh Ln","75229"],["Inwood Rd","75209"],["Turtle Creek Blvd","75219"],
    ["Hall St","75204"],["Canton St","75226"],["Exposition Ave","75226"],
    ["Munger Ave","75204"],["Live Oak St","75204"],["Cedar Springs Rd","75219"],
    ["Routh St","75204"],["Throckmorton St","75219"],["Swiss Ave","75204"],
    ["Carroll Ave","75204"],["Matilda St","75206"],["Lewis St","75206"],
    ["Paulus Ave","75206"],["Belmont Ave","75206"],["Vickery Blvd","75206"],
    ["Richmond Ave","75206"],["Oram St","75214"],["Velasco St","75214"],
    ["Reiger Ave","75214"],["Alcalde St","75208"],["Gilmore Ave","75208"],
    ["Edgefield Ave","75208"],["Kiestwood Dr","75211"],["Ravinia Dr","75211"],
    ["Plymouth Rd","75235"],["Medical District Dr","75235"],["Maple Ave","75219"],
    ["Wycliff Ave","75219"],["Reagan St","75219"],["Douglas Ave","75225"],
    ["Lomo Alto Dr","75225"],["Bordeaux Ave","75209"],["Southwestern Blvd","75225"],
    ["Meadow Rd","75230"],["Midway Rd","75244"],["Nuestra Dr","75228"],
    ["Garland Rd","75218"],["White Rock Trl","75218"],["Peavy Rd","75218"],
    ["Buckner Blvd","75227"],["Saner Ave","75216"],["Marsalis Ave","75216"],
    ["Beckley Ave","75203"],["Sunset Ave","75208"],["Clarendon Dr","75208"],
  ];

  const demoWalkerProfiles = {};
  const demoWalkerNames = [];
  WALKER_INFO.forEach(([first, last, slug], i) => {
    const id = 2000 + i;
    const name = `${first} ${last}`;
    demoWalkerNames.push(name);
    const pin = String((1357 + i * 83) % 9000 + 1000);
    // Give each walker a unique Dallas address from the back of the pool
    const [wStreet, wZip] = STREETS[(STREETS.length - 1 - i) % STREETS.length];
    const wStreetNum = 2000 + (i * 23) % 7000;
    const wAddress = `${wStreetNum} ${wStreet}, Dallas, TX ${wZip}`;
    const wAreaCode = AREA_CODES[i % AREA_CODES.length];
    const wPhone = `${wAreaCode}-${300 + (i * 17) % 700}-${String(4000 + (i * 31) % 5999)}`;
    demoWalkerProfiles[id] = {
      id, name, email: `${slug}@demowalk.com`,
      pin, role: WALKER_ROLES[i], years: 1 + (i % 10),
      bio: WALKER_BIOS[i], avatar: WALKER_AVATARS[i],
      color: WALKER_COLORS[i],
      services: WALKER_SERVICES[i % WALKER_SERVICES.length],
      address: wAddress,
      addrObj: { street: `${wStreetNum} ${wStreet}`, city: "Dallas", state: "TX", zip: wZip },
      phone: wPhone,
      isCustom: true, isDemo: true, showOnTeamPage: false,
      createdAt: new Date().toISOString(),
    };
  });

  // ── 150 Demo Clients ────────────────────────────────────────────
  const FIRSTS = [
    "Emma","Liam","Olivia","Noah","Ava","Ethan","Sophia","Mason","Isabella","Logan",
    "Mia","Lucas","Charlotte","Aiden","Amelia","Elijah","Harper","James","Evelyn","Benjamin",
    "Abigail","Alexander","Emily","Michael","Elizabeth","Daniel","Sofia","Jackson","Avery","Sebastian",
    "Ella","Jack","Scarlett","Owen","Grace","Ryan","Victoria","Nathan","Riley","Dylan",
    "Aria","Henry","Lily","Carter","Eleanor","Joseph","Hannah","Charles","Lillian","Samuel",
    "Addison","Christopher","Aubrey","Andrew","Ellie","Joshua","Stella","David","Natalie","Wyatt",
    "Zoe","John","Leah","Luke","Hazel","Anthony","Violet","Isaac","Aurora","Gabriel",
    "Savannah","Julian","Audrey","Levi","Brooklyn","Ezra","Claire","Aaron","Skylar","Thomas",
    "Lucy","Adrian","Paisley","Oliver","Everly","Nolan","Anna","Connor","Caroline","Jeremiah",
    "Nova","Eli","Genesis","Colton","Miles","Jason","Samantha","Robert","Ashley","Tyler",
    "Brianna","Brandon","Taylor","Kevin","Lauren","Justin","Jessica","William","Nicole","Jordan",
    "Amber","Derek","Melissa","Trevor","Rachel","Marcus","Diana","Todd","Heather","Scott",
    "Tiffany","Chad","Crystal","Bradley","Danielle","Randy","Jennifer","Greg","Stephanie","Jeff",
    "Kimberly","Craig","Shannon","Glen","Tara","Brian","Patricia","Dennis","Monica","Larry",
    "Sandra","Keith","Donna","Frank","Carol","George","Alice","Roger","Teresa","Gary",
  ];
  const LASTS = [
    "Smith","Johnson","Williams","Brown","Jones","Garcia","Miller","Davis","Rodriguez","Martinez",
    "Hernandez","Lopez","Gonzalez","Wilson","Anderson","Thomas","Taylor","Moore","Jackson","Martin",
    "Lee","Perez","Thompson","White","Harris","Sanchez","Clark","Ramirez","Lewis","Robinson",
    "Walker","Young","Allen","King","Wright","Scott","Torres","Nguyen","Hill","Flores",
    "Green","Adams","Nelson","Baker","Hall","Rivera","Campbell","Mitchell","Carter","Roberts",
    "Murphy","Cook","Rogers","Morgan","Peterson","Cooper","Reed","Bailey","Bell","Gomez",
    "Kelly","Howard","Ward","Cox","Diaz","Richardson","Wood","Watson","Brooks","Bennett",
    "Gray","James","Reyes","Cruz","Hughes","Price","Myers","Long","Foster","Sanders",
    "Ross","Morales","Powell","Sullivan","Russell","Ortiz","Jenkins","Gutierrez","Perry","Butler",
    "Barnes","Fisher","Henderson","Coleman","Simmons","Patterson","Jordan","Reynolds","Hamilton","Graham",
  ];
  const DOG_NAMES = [
    "Buddy","Max","Charlie","Cooper","Bear","Duke","Rocky","Beau","Tucker","Oliver",
    "Bentley","Milo","Leo","Zeus","Winston","Jax","Harley","Murphy","Hunter","Sam",
    "Bella","Luna","Daisy","Lucy","Molly","Lola","Sadie","Maggie","Sophie","Zoe",
    "Chloe","Stella","Gracie","Rosie","Coco","Penny","Ellie","Ginger","Abby","Remi",
    "Pepper","Nala","Ruby","Sasha","Lady","Lily","Zoey","Lexi","Piper","Roxy",
  ];
  const CAT_NAMES = [
    "Whiskers","Mittens","Shadow","Tiger","Smokey","Oreo","Simba","Luna","Nala","Leo",
    "Oliver","Bella","Cleo","Mochi","Biscuit","Pepper","Salem","Binx","Misty","Felix",
  ];
  const MONTH_NAMES = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const DAY_NAMES = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
  const NOTES_LIST = [
    "","","","Please use the back gate.",
    "Shy around other dogs — keep on leash.",
    "Loves treats! Bag is on the counter.",
    "Don't let her off leash at the park.",
    "Extra key is under the mat.",
    "He gets anxious — extra patience please!",
    "Please send a photo update if you can.",
  ];

  function makeBooking(clientId, clientName, email, phone, address, petName, service,
                       walkerName, daysOffset, isCompleted) {
    const d = new Date(now);
    d.setDate(d.getDate() + daysOffset);
    const hour = pick([7,8,9,10,11,14,15,16,17]);
    d.setHours(hour, 0, 0, 0);
    const duration = pick(["30 min","30 min","60 min"]);
    const price = duration === "60 min" ? 45 : 30;
    const dateLabel = `${MONTH_NAMES[d.getMonth()]} ${d.getDate()}`;
    const dayName = DAY_NAMES[d.getDay()];
    const slotTime = hour < 12 ? `${hour}:00 AM` : hour === 12 ? "12:00 PM" : `${hour-12}:00 PM`;
    const key = `demo-${service}-${d.toISOString().slice(0,10)}-${hour}-${clientId}`;
    return {
      key, service, day: dayName, date: dateLabel,
      slot: { id: `${hour}:00`, time: slotTime, duration, hour, minute: 0 },
      form: {
        name: clientName, pet: petName, email, phone, address,
        walker: walkerName, notes: pick(NOTES_LIST), additionalDogs: [],
      },
      bookedAt: new Date(d.getTime() - 86400000 * randomInt(1,7)).toISOString(),
      scheduledDateTime: d.toISOString(),
      additionalDogCount: 0, additionalDogCharge: 0,
      price, priceTier: "Easy Rider",
      adminScheduled: true, isDemo: true,
      ...(isCompleted ? {
        adminCompleted: true, walkerMarkedComplete: true,
        completedAt: d.toISOString(),
      } : {}),
    };
  }

  // ── Build 150 client shells (no bookings yet) ──────────────────
  const demoClients = {};
  const clientMeta  = []; // parallel array for booking assignment
  for (let i = 0; i < 150; i++) {
    const first = FIRSTS[i % FIRSTS.length];
    const last  = LASTS[Math.floor(i / FIRSTS.length) % LASTS.length] || LASTS[i % LASTS.length];
    const name  = `${first} ${last}`;
    const email = `${first.toLowerCase()}.${last.toLowerCase()}${i}@democlient.com`;
    const [streetName, zip] = STREETS[i % STREETS.length];
    const streetNum = 1000 + (i * 17) % 8000;
    const address = `${streetNum} ${streetName}, Dallas, TX ${zip}`;
    const phone = `${AREA_CODES[i % 3]}-${randomInt(200,999)}-${String(randomInt(1000,9999))}`;
    const petType  = i % 10 < 7 ? "dog" : i % 10 < 9 ? "cat" : "both";
    const dogs     = (petType === "dog" || petType === "both") ? [DOG_NAMES[i % DOG_NAMES.length]] : [];
    const cats     = (petType === "cat" || petType === "both") ? [CAT_NAMES[i % CAT_NAMES.length]] : [];
    const service  = cats.length && !dogs.length ? "cat" : "dog";
    const petName  = dogs[0] || cats[0] || "Pet";
    const walkerName = demoWalkerNames[i % demoWalkerNames.length];
    const clientId = `demo-client-${i + 1}`;

    demoClients[clientId] = {
      id: clientId, name, email, phone, address,
      addrObj: { street: `${streetNum} ${streetName}`, city: "Dallas", state: "TX", zip },
      dogs, cats, pets: dogs, bookings: [],
      pin: String(randomInt(1000, 9999)),
      createdAt: new Date(now.getTime() - randomInt(1, 180) * 86400000).toISOString(),
      handoffDone: true, isDemo: true,
    };
    clientMeta.push({ clientId, name, email, phone, address, petName, service, walkerName });
  }

  // ── Generate appointments day-by-day: -14 to +14, min 15/day ──
  // Hours spread across morning and afternoon so the schedule looks real
  const APPT_HOURS = [7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18];
  let clientCursor = 0; // round-robin through clients

  for (let dayOffset = -14; dayOffset <= 14; dayOffset++) {
    const isCompleted = dayOffset < 0;
    const apptCount   = randomInt(15, 22); // at least 15, up to 22

    for (let a = 0; a < apptCount; a++) {
      const meta = clientMeta[clientCursor % clientMeta.length];
      clientCursor++;

      // Spread hours evenly across the day, with slight randomisation
      const hour = APPT_HOURS[(a + randomInt(0, 2)) % APPT_HOURS.length];

      const booking = makeBooking(
        meta.clientId, meta.name, meta.email, meta.phone,
        meta.address, meta.petName, meta.service,
        meta.walkerName, dayOffset, isCompleted,
      );

      // Override the hour so multiple slots exist per day
      const d2 = new Date(booking.scheduledDateTime);
      d2.setHours(hour, 0, 0, 0);
      const slotTime = hour < 12
        ? `${hour}:00 AM`
        : hour === 12 ? "12:00 PM"
        : `${hour - 12}:00 PM`;
      booking.scheduledDateTime = d2.toISOString();
      booking.slot = { ...booking.slot, time: slotTime, hour, id: `${hour}:00` };
      booking.key  = `demo-${meta.service}-${d2.toISOString().slice(0,10)}-${hour}-${meta.clientId}-${a}`;

      demoClients[meta.clientId].bookings.push(booking);
    }
  }

  return { demoWalkerProfiles, demoClients };
}

function removeDemoData(clients, walkerProfiles) {
  const cleanClients = Object.fromEntries(
    Object.entries(clients).filter(([, c]) => !c.isDemo)
  );
  const cleanWalkers = Object.fromEntries(
    Object.entries(walkerProfiles).filter(([, w]) => !w.isDemo)
  );
  return { cleanClients, cleanWalkers };
}



// ─── Admin Demo Data Section ──────────────────────────────────────────────────
function AdminDemoDataSection({ clients, setClients, walkerProfiles, setWalkerProfiles }) {
  const amber = "#b45309";
  const [status, setStatus] = useState("idle"); // "idle" | "generating" | "done" | "removing"

  const hasDemoData = Object.values(clients).some(c => c.isDemo) ||
                      Object.values(walkerProfiles).some(w => w.isDemo);

  const handleGenerate = async () => {
    setStatus("generating");
    await new Promise(r => setTimeout(r, 80));
    const { demoWalkerProfiles, demoClients } = buildDemoData();
    const newWalkers = { ...walkerProfiles, ...demoWalkerProfiles };
    const newClients = { ...clients, ...demoClients };
    injectCustomWalkers(newWalkers);
    setWalkerProfiles(newWalkers);
    setClients(newClients);
    await Promise.all([saveClients(newClients), saveWalkerProfiles(newWalkers)]);
    setStatus("done");
  };

  const handleRemove = async () => {
    setStatus("removing");
    await new Promise(r => setTimeout(r, 80));

    // Collect demo record identifiers for Supabase deletion
    const demoClientPins = Object.entries(clients)
      .filter(([, c]) => c.isDemo).map(([pin]) => pin);
    const demoWalkerIds = Object.entries(walkerProfiles)
      .filter(([, w]) => w.isDemo).map(([id]) => id);

    // Delete demo rows from Supabase (upsert won't remove them)
    try {
      if (demoClientPins.length > 0) {
        const pinList = demoClientPins.map(p => `"${p}"`).join(",");
        await sbFetch(`clients?pin=in.(${pinList})`,
          { method: "DELETE", headers: { "Prefer": "" } });
      }
      if (demoWalkerIds.length > 0) {
        await sbFetch(`walkers?walker_id=in.(${demoWalkerIds.join(",")})`,
          { method: "DELETE", headers: { "Prefer": "" } });
      }
    } catch (e) {
      console.error("Demo data Supabase deletion failed:", e);
    }

    const { cleanClients, cleanWalkers } = removeDemoData(clients, walkerProfiles);
    injectCustomWalkers(cleanWalkers);
    setWalkerProfiles(cleanWalkers);
    setClients(cleanClients);
    setStatus("idle");
  };

  const demoClientCount = Object.values(clients).filter(c => c.isDemo).length;
  const demoWalkerCount = Object.values(walkerProfiles).filter(w => w.isDemo).length;

  return (
    <div style={{ background: "#fff", borderRadius: "16px", border: "1.5px solid #e4e7ec",
      padding: "24px", marginTop: "24px" }}>
      <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px",
        textTransform: "uppercase", letterSpacing: "1.5px", fontWeight: 600,
        color: "#111827", marginBottom: "6px" }}>Demo Data</div>
      <p style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px", color: "#6b7280",
        marginBottom: "20px", lineHeight: "1.6" }}>
        Populate the app with realistic demo walkers, clients, and bookings for testing.
        Demo data is tagged and can be removed without affecting real data.
      </p>

      {hasDemoData && (
        <div style={{ background: "#fefce8", border: "1.5px solid #fde68a",
          borderRadius: "10px", padding: "12px 16px", marginBottom: "16px",
          fontFamily: "'DM Sans', sans-serif", fontSize: "14px", color: "#92400e" }}>
          ⚠️ Demo data is currently active — <strong>{demoWalkerCount} walkers</strong> and{" "}
          <strong>{demoClientCount} clients</strong>.
        </div>
      )}

      <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
        {!hasDemoData ? (
          <button onClick={handleGenerate} disabled={status === "generating"}
            style={{ padding: "12px 20px", borderRadius: "10px", border: "none",
              background: status === "generating" ? "#e4e7ec" : amber,
              color: status === "generating" ? "#9ca3af" : "#fff",
              fontFamily: "'DM Sans', sans-serif", fontSize: "15px",
              fontWeight: 600, cursor: status === "generating" ? "default" : "pointer" }}>
            {status === "generating" ? "Generating…" : "✦ Generate Demo Data"}
          </button>
        ) : (
          <>
            <button onClick={handleGenerate} disabled={status === "generating"}
              style={{ padding: "12px 20px", borderRadius: "10px",
                border: "1.5px solid #e4e7ec", background: "#f9fafb",
                color: "#374151", fontFamily: "'DM Sans', sans-serif",
                fontSize: "15px", fontWeight: 500,
                cursor: status === "generating" ? "default" : "pointer" }}>
              {status === "generating" ? "Generating…" : "↺ Regenerate"}
            </button>
            <button onClick={handleRemove} disabled={status === "removing"}
              style={{ padding: "12px 20px", borderRadius: "10px",
                border: "1.5px solid #fca5a5", background: "#fff5f5",
                color: status === "removing" ? "#9ca3af" : "#dc2626",
                fontFamily: "'DM Sans', sans-serif", fontSize: "15px",
                fontWeight: 500, cursor: status === "removing" ? "default" : "pointer" }}>
              {status === "removing" ? "Removing…" : "✕ Remove Demo Data"}
            </button>
          </>
        )}
      </div>

      {status === "done" && (
        <div style={{ marginTop: "14px", background: "#f0fdf4",
          border: "1.5px solid #86efac", borderRadius: "10px", padding: "14px 16px" }}>
          <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px",
            fontWeight: 600, color: "#16a34a", marginBottom: "4px" }}>✓ Demo data loaded!</div>
          <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "14px", color: "#15803d" }}>
            20 walkers and 150 clients with bookings are now in the system.
            Switch to any tab to explore. Use "Remove Demo Data" when done.
          </div>
        </div>
      )}
    </div>
  );
}


export default AdminDemoDataSection;
