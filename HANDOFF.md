# Handoff Spec: MH Wilds Second-Screen Hunt Dashboard (Layout A · Tactical)

> สำหรับส่งต่อให้ Claude Code ทำตัวจริง · อ้างอิงหน้าตาจาก `Main.dc.html` (mockup แบบ A)
> ตัวเลขและชื่อทั้งหมดใน mockup เป็นข้อมูลตัวอย่าง

---

## 1. Overview

Dashboard แสดงข้อมูลการล่าแบบ real-time บน **จอที่สอง** ของ PC เพื่อให้จอเกมสะอาด ไม่มี overlay ทับ
ผู้ใช้เหลือบดูจากหางตาระหว่างสู้ ดังนั้นข้อมูลสำคัญต้อง **ตัวใหญ่ สีบอกสถานะ อ่านได้ในเสี้ยววินาที**

- แพลตฟอร์ม: เกม PC (Steam) เท่านั้น
- จอเป้าหมาย: 1920×1080 (mockup ออกแบบที่ 1600×900 แล้ว scale ขึ้น)
- การใช้งาน: เปิดค้างไว้ทั้ง session ไม่ต้องโต้ตอบระหว่างเล่น

## 2. Architecture

```
[MH Wilds + REFramework]
   └─ Lua script (autorun)  ── อ่านข้อมูลเกม (read-only) ทุก ~200ms
         │  เขียน JSON (ไฟล์) หรือส่งผ่าน local socket
         ▼
[Bridge server]  Node.js หรือ Python, localhost only
         │  WebSocket  ws://127.0.0.1:<port>
         ▼
[Dashboard UI]  เว็บแอป เปิดในเบราว์เซอร์ (F11) หรือห่อด้วย Tauri/Electron
```

หลักการสำคัญ
- **Read-only เท่านั้น** ห้ามเขียนค่าใดๆ กลับเข้าเกม
- Bridge bind ที่ `127.0.0.1` เท่านั้น ไม่เปิดออก LAN
- UI ต้องทำงานได้ด้วย **mock data** (ไฟล์ JSON ตัวอย่าง + โหมด replay) เพื่อพัฒนาโดยไม่ต้องเปิดเกม
- **ยังไม่มีการยืนยันชื่อ field / type ใน REFramework สำหรับ Wilds** ให้ค้นจาก REFramework docs และ Lua mod ที่มีอยู่ (เช่น health bars mod บน Nexus) ห้ามเดาชื่อ field แล้วเขียนเหมือนรู้แน่ ให้แยกชั้นอ่านข้อมูลเกมไว้ใน module เดียว (`game_reader.lua`) เพื่อแก้ง่ายเมื่อเกมอัปเดต
- ทางเลือกสำรอง: ถ้า Lua ทำยาก ให้ศึกษา HunterPie (open source) ว่าดึงข้อมูลอะไรได้บ้าง แต่ห้าม copy asset ของเกม

## 3. Data Contract (WebSocket payload)

ส่งเป็น snapshot ทั้งก้อนทุก tick (ง่ายกว่า diff, ข้อมูลเล็ก)

```jsonc
{
  "v": 1,
  "ts": 1791077420123,            // epoch ms ตอนอ่าน
  "connected": true,              // อ่านจากเกมได้หรือไม่
  "quest": {
    "name": "string | null",
    "elapsedSec": 754,
    "limitSec": 3000,
    "active": true
  },
  "world": { "clock": "18:20", "phase": "night" },   // phase: day | night | dusk | dawn
  "targetId": "m1",
  "monsters": [
    {
      "id": "m1",
      "name": "Rey Dau",
      "hp": 4320, "hpMax": 24000,
      "captureThreshold": 0.20,    // ถ้าอ่านไม่ได้ ใช้ default 0.20
      "sizePct": 112, "crown": "gold",   // gold | silver | mini | null
      "enraged": true, "enrageRemainSec": 41,
      "wounds": 3,
      "parts": [
        { "id": "head", "name": "หัว", "kind": "head", "hp": 120, "hpMax": 1000, "broken": false }
      ],
      "ailments": [
        { "id": "paralysis", "buildup": 0.82, "procs": 1 }
      ]
    }
  ],
  "player": {
    "buffs": [
      { "id": "demondrug", "name": "Demondrug", "remainSec": null },   // null = ไม่หมดเวลา
      { "id": "might_seed", "name": "Might Seed", "remainSec": 12 }
    ]
  },
  "party": [
    { "name": "คุณ", "self": true, "damage": 9820 }
  ]
}
```

ค่าที่ UI คำนวณเอง (ไม่ต้องส่งมา): HP %, % ของ part, % ดาเมจ, DPS, การเรียง part, flag "ใกล้"

## 4. Layout (1600×900 reference)

```
┌──────────────────────────────── Header 56px ────────────────────────────────┐
├─ Monster 470px ─┬────────── Parts (flex 1) ──────────┬─ Right col 390px ──┤
│ avatar+name     │ part row × N                        │ Ailments            │
│ HP ring 300px   │                                     ├─────────────────────┤
│ capture banner  │                                     │ Buffs (2×2)         │
│ wounds | breaks │                                     │                     │
├─────────────────┴─────────────────────────────────────┴─────────────────────┤
│ Damage meter (label 150px + 4 equal columns)                                │
└─────────────────────────────────────────────────────────────────────────────┘
```

- Root: padding 24px 28px, `flex column`, gap 18px
- Main grid: `grid-template-columns: 470px minmax(0,1fr) 390px`, gap 18px
- ทุก panel: radius 18px, border 1px, padding 20–28px
- ทำ scale ทั้งหน้าตามขนาดหน้าต่าง (เช่น CSS `zoom`/transform จาก 1600×900) เพื่อให้สัดส่วนคงที่บนจอ 1080p/1440p/4K

## 5. Design Tokens

### Color
| Token | Value | Usage |
|---|---|---|
| `bg` | `#0B0E13` | พื้นหลังหน้า |
| `surface` | `#151A21` | panel |
| `surface-2` | `#1B212A` | แถว/การ์ดใน panel |
| `track` | `#1F2630` | ราง progress bar |
| `border` | `#232A35` | ขอบ panel |
| `text` | `#E8E6E1` | ตัวหนังสือหลัก |
| `text-2` | `#B8C0CA` | ตัวหนังสือรอง |
| `text-muted` | `#8C96A3` | label / หัวข้อ panel |
| `text-disabled` | `#6F7987` | part ที่ทำลายแล้ว |
| `accent` | `#F2A541` | **ต้องรีบทำ**: จับได้, ใกล้ทำลาย, บัฟใกล้หมด, ตัวเรา |
| `accent-bg` / `accent-border` | `#221B10` / `#6B4A1C` | พื้น/ขอบแถวที่ไฮไลต์ |
| `on-accent` | `#1A1206` | ตัวหนังสือบนพื้น accent |
| `info` | `#5AA9E6` | progress ปกติ |
| `info-soft` / `info-bg` | `#7CC0F2` / `#172A3B` | ไอคอน part ปกติ |
| `danger` | `#E5533D` | ขอบป้ายโกรธ (ใช้กับ **enrage เท่านั้น**) |
| `danger-text` / `danger-bg` | `#FF8C79` / `#3A1714` | ป้ายโกรธ, แผล |
| `ok` | `#5BC489` | สถานะเชื่อมต่อ |
| `buff` | `#8FD3A8` | ไอคอนบัฟปกติ |
| `crown` | `#E9C46A` | มงกุฎ |
| `ail-paralysis` | `#E6C84A` บน `#2E2810` | อัมพาต |
| `ail-poison` | `#B48BE8` บน `#251C33` | พิษ |
| `ail-stun` | `#E8E6E1` บน `#262B33` | สตัน |
| `ail-sleep` | `#8FB4F2` บน `#17233A` | หลับ |
| `party-2..4` | `#5AA9E6`, `#8FD3A8`, `#B48BE8` | ผู้เล่นอื่น |

กฎสี: ส้ม = action ที่ควรทำตอนนี้ · แดง = enrage อย่างเดียว · สีต้องต่างกันที่ความสว่างด้วย ไม่ใช่แค่ hue

### Typography
Font: **Chakra Petch** (Google Fonts, รองรับไทย+ละติน) weights 400/500/600/700 · ใช้ `font-variant-numeric: tabular-nums` กับตัวเลขที่เปลี่ยนตลอด

| Token | Size / Weight | Usage |
|---|---|---|
| `num-hero` | 88 / 700 (หน่วย % 40) | HP กลางวง |
| `num-lg` | 28 / 700 | เวลาเควส |
| `title-lg` | 30 / 700 | ชื่อมอน |
| `num-md` | 24 / 700 | ตัวเลขการ์ด, เวลาบัฟ |
| `row-title` | 21 / 600 | ชื่อ part, banner จับได้ |
| `body` | 17 / 600 | ชื่อ ailment, label |
| `body-sm` | 15 | รายละเอียดรอง |
| `eyebrow` | 13 / letter-spacing 3px | หัวข้อ panel |

### Spacing / Radius
spacing: 6, 8, 10, 12, 14, 16, 18, 24, 28 · radius: 4 (bar เล็ก), 10–12 (icon tile, card), 14 (part row), 18 (panel), วงกลมเต็ม (avatar, dot)

## 6. Components

| Component | Props | Notes |
|---|---|---|
| `Header` | quest, world, connected | logo tile 44px accent · chip เวลา (ไอคอนนาฬิกา) · chip เวลาในเกม (ไอคอนพระจันทร์/ดวงอาทิตย์ตาม phase) · chip สถานะเชื่อมต่อ |
| `MonsterCard` | monster | avatar 58px (ไอคอนกรงเล็บ ไม่ใช้รูปเกม) · มงกุฎ · `EnrageBadge` · `HpRing` · `CaptureBanner` · `StatTile`×2 |
| `HpRing` | hp, hpMax, threshold | SVG 300px r=130 stroke 24 · เริ่มที่ 12 นาฬิกา ตามเข็ม · ขีดขาว 3px ที่ตำแหน่ง threshold · สีวง: info ถ้า > threshold, accent ถ้า ≤ threshold |
| `EnrageBadge` | remainSec | ไอคอนไฟ + "โกรธ" + mm:ss · ซ่อนเมื่อไม่โกรธ |
| `CaptureBanner` | visible | พื้น accent, ไอคอนเป้า, "จับได้แล้ว · ใช้กับดักได้" · แสดงเมื่อ HP ≤ threshold |
| `StatTile` | icon, label, value, tone | แผลที่เปิด (danger), ทำลายแล้ว x/y (info) |
| `PartRow` | part | icon tile 42px ตาม `kind` · ชื่อ · ค่า % · bar 10px · variants: normal / near (<25% เหลือ) / broken |
| `AilmentRow` | ailment | icon tile 36px สีตามชนิด · ×procs · % · bar 8px สีตามชนิด |
| `BuffCard` | buff | grid 2 คอลัมน์ · icon + ชื่อ + เวลา 24px · variants: normal / warn (≤30s) / infinite (∞) |
| `DamageMeter` | party, elapsedSec | label + DPS · 4 คอลัมน์เท่ากัน · dot สี + ชื่อ + ดาเมจ + % · ตัวเราสี accent |

### Icon set
ไอคอนเส้น (stroke) viewBox 24, stroke-width 1.8–2.2, round caps/joins, `currentColor` · **วาดเอง ห้ามใช้ asset จากเกม** · path data อยู่ใน `Main.dc.html` (object `I` ใน script และ inline SVG) — ย้ายมาเป็น `icons.ts` ที่ map ตาม id
ชุดที่มี: clock, moon, claw (logo/avatar/wound), crown, flame, target, hammer (break), head, wing, tail, leg, check, bolt, drop, star, zz, flask, leaf, shield, cup, sword
ทำให้ map icon ตาม id ของ buff/ailment/part kind และมี fallback icon เมื่อไม่รู้จัก id
(เผื่ออนาคต) รองรับ override จากโฟลเดอร์ไอคอนในเครื่องผู้ใช้ตาม id — ไม่ bundle ไฟล์ใดๆ ของเกมมากับโปรเจกต์

## 7. States & Logic

| Element | State | Behavior |
|---|---|---|
| ทั้งหน้า | ยังไม่เชื่อมต่อ bridge | overlay กลางจอ "รอเชื่อมต่อ…" + chip สถานะสีเทา · พยายาม reconnect ทุก 2s |
| ทั้งหน้า | เชื่อมต่อแต่ข้อมูลเก่า > 2s | chip เปลี่ยนเป็นส้ม "ข้อมูลไม่อัปเดต" · ข้อมูลเดิมจางลง 50% |
| ทั้งหน้า | ไม่ได้อยู่ในเควส | แสดง Header + ข้อความ "ยังไม่ได้อยู่ในเควส" กลาง panel · ซ่อนตัวเลข |
| MonsterCard | ไม่มีเป้า | ใช้มอนตัวแรกในลิสต์ · ถ้าไม่มีเลย แสดง empty state |
| MonsterCard | หลายตัว | แสดงตัวที่ `targetId` · มี pill เล็กบอก "+1 ตัว" (layout แบบ split เป็นงานถัดไป) |
| MonsterCard | ตาย/จับแล้ว | วงเทา + ป้าย "ล่าสำเร็จ" |
| HpRing | HP ≤ threshold | วงเป็น accent + แสดง CaptureBanner |
| PartRow | near (<25%) | พื้น `accent-bg`, ขอบ `accent-border`, ข้อความ "อีก N%" สีส้ม |
| PartRow | broken | ไอคอน check สีจาง, ข้อความ "ทำลายแล้ว", bar ว่าง |
| PartRow | การเรียง | ยังไม่ทำลาย เรียงตาม % เหลือน้อยก่อน → ทำลายแล้วไว้ท้าย |
| AilmentRow | buildup ≥ 75% | ตัวเลขเป็นตัวหนาสีของชนิดนั้น |
| AilmentRow | ไม่มีข้อมูล | ซ่อนแถว (ไม่แสดง 0% ปลอม) |
| BuffCard | ≤ 30s | variant warn (ส้ม) |
| BuffCard | หมดเวลา | หายไปจากลิสต์ |
| DamageMeter | เล่นคนเดียว | แสดงคอลัมน์เดียว 100% |

## 8. Animation / Motion

| Element | Trigger | Animation | Duration | Easing |
|---|---|---|---|---|
| progress bar / HP ring | ค่าเปลี่ยน | tween width / dash | 250ms | ease-out |
| CaptureBanner | ปรากฏครั้งแรก | fade + scale 0.96→1 แล้ว pulse 2 ครั้ง | 300ms + 2×600ms | ease-out |
| EnrageBadge | เริ่มโกรธ | fade in + ขอบกระพริบ 2 ครั้ง | 200ms | ease-out |
| PartRow | เพิ่งทำลาย | flash พื้นจางลง | 600ms | ease-out |
| PartRow | เปลี่ยนลำดับ | FLIP reorder | 250ms | ease-in-out |

เคารพ `prefers-reduced-motion`: ปิด pulse/flash เหลือแค่เปลี่ยนค่าทันที
ห้ามมีอนิเมชันวนตลอดเวลา (รบกวนสายตาตอนเล่น)

## 9. Edge Cases

- **ชื่อยาว** (ชื่อมอน/part/ผู้เล่น): ตัดด้วย ellipsis 1 บรรทัด ห้ามดัน layout
- **part มากกว่า 6**: panel scroll แนวตั้งภายใน (ไม่ใช่ทั้งหน้า) หรือแสดง 6 อันดับแรก + "อีก N ส่วน"
- **ภาษา**: UI strings แยกไว้ไฟล์เดียว (ไทยเป็นค่าเริ่มต้น) เผื่อเพิ่ม EN
- **เกมอัปเดตแล้ว script พัง**: bridge ส่ง `connected:false` + error message สั้น · UI แสดงสถานะชัดเจน ไม่ค้าง
- **ตัวเลขเพี้ยน** (hp > hpMax, ค่าลบ): clamp 0–100%
- **ค่าที่อ่านไม่ได้** (crown, threshold, enrage timer): ซ่อน element นั้น ไม่แสดงค่าปลอม

## 10. Accessibility / Usability

- Contrast ตัวหนังสือ ≥ 4.5:1 บนพื้น panel (ค่าใน tokens ผ่านแล้ว ห้ามจางกว่านี้)
- ไม่สื่อสถานะด้วยสีอย่างเดียว: มีไอคอน + ข้อความกำกับเสมอ (เช่น "อีก 12%", "ทำลายแล้ว")
- ไม่ต้องโต้ตอบระหว่างเล่น แต่มีหน้า settings แยก (เข้าด้วยปุ่ม/คีย์ลัด) ที่ keyboard ใช้ได้: port, scale, เปิด/ปิด panel แต่ละอัน
- หน้าต่างไม่ขโมย focus จากเกม

## 11. Suggested Stack (ปรับได้)

- UI: Vite + TypeScript (React หรือ Svelte), CSS variables จาก tokens ข้างบน
- Bridge: Node.js `ws` (หรือ Python `websockets`)
- Desktop wrapper (ทางเลือก): Tauri, borderless, เปิดค้างบนจอที่สอง จำตำแหน่งหน้าต่าง
- Dev: `mock/` มี snapshot JSON หลายสถานะ (ปกติ, โกรธ, จับได้, หลายมอน, ไม่เชื่อมต่อ) + โหมด replay

## 12. Milestones & Acceptance

1. **UI + mock data** — หน้าแบบ A ตรง mockup, สลับ mock ได้ทุกสถานะในข้อ 7
2. **Bridge + WebSocket** — reconnect, stale detection, localhost only
3. **Lua reader** — อ่าน HP มอน + เวลาเควสได้จริงก่อน แล้วค่อยเพิ่ม parts → ailments → buffs → damage
4. **Desktop wrapper + settings**

Done เมื่อ: เปิดเกมแล้ว dashboard อัปเดตภายใน ≤ 300ms, ปิดเกม/ปิด bridge แล้ว UI แสดงสถานะถูกต้องไม่ค้าง, ไม่มีการเขียนค่ากลับเข้าเกม
