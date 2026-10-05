-- Hunt Dashboard: every game-specific read lives in this file (spec §2).
-- READ-ONLY. Never set_field / call a mutating method here.
--
-- Field/method names below are not guesses: each one is taken from mods that
-- already run on Wilds (MHWilds Overlay 1.14 + _CatLib, HunterPie Multiplayer Sync).
-- When a game update breaks something, fix it here only.
local Core = require("_CatLib")

local M = {}

-- app.EnemyDef.CONDITION values (from _CatLib.const EnemyConditionType)
local AILMENTS = {
    [5] = "paralysis", [3] = "poison", [15] = "stun", [7] = "sleep", [9] = "blast",
    [13] = "ride", [18] = "flash", [31] = "pitfall",
}
-- app.EnemyDef.CrownType: None=0 Small=1 Big=2 King=3
local CROWNS = { [1] = "mini", [2] = "silver", [3] = "gold" }
-- app.cHunterItemBuff fields (from mhwilds_overlay/status/data.lua) → our buff id + item id for the localized name
local ITEM_BUFFS = {
    { id = "might_seed",   item = 125, timer = "_Kairiki_Timer",     max = "_Kairiki_MaxTime" },
    { id = "might_pill",   item = 168, timer = "_Kairiki_G_Timer",   max = "_Kairiki_G_MaxTime" },
    { id = "adamant_seed", item = 126, timer = "_Nintai_Timer",      max = "_Nintai_MaxTime" },
    { id = "adamant_pill", item = 171, timer = "_Nintai_G_Timer",    max = "_Nintai_G_MaxTime" },
    { id = "demon_powder", item = 175, timer = "_KijinPowder_Timer", max = "_KijinPowder_MaxTime" },
    { id = "hard_powder",  item = 176, timer = "_KoukaPowder_Timer", max = "_KoukaPowder_MaxTime" },
    { id = "dash_juice",   item = 163, timer = "_DashJuice_Timer",   max = "_DashJuice_MaxTime" },
    { id = "immunizer",    item = 164, timer = "_Immunizer_Timer",   max = "_Immunizer_MaxTime" },
    { id = "hot_drink",    item = 166, timer = "_HotDrink_Timer",    max = "_HotDrink_MaxTime" },
    { id = "cool_drink",   item = 165, timer = "_CoolerDrink_Timer", max = "_CoolerDrink_MaxTime" },
    { id = "demondrug",      item = 167, sub = "_KijinDrink" },
    { id = "mega_demondrug", item = 169, sub = "_KijinDrink_G" },
    { id = "armorskin",      item = 170, sub = "_KoukaDrink" },
    { id = "mega_armorskin", item = 172, sub = "_KoukaDrink_G" },
}

local function addr(obj) return string.format("%x", obj:get_address()) end

local function safe(fn, ...)
    local ok, v = pcall(fn, ...)
    if ok then return v end
    return nil
end

-- Like safe(), but remembers the first error per tag; the snapshot carries them as `errors`
-- so a recording (npm run bridge -- --record) shows *why* a field is missing after a game update.
local errors = {}
local function try(tag, fn, ...)
    local ok, v = pcall(fn, ...)
    if ok then return v end
    if errors[tag] == nil then errors[tag] = tostring(v):sub(1, 200) end
    return nil
end

---------------------------------------------------------------------------
-- Damage meter: the hook only reads the hit (same hook MHWilds Overlay uses).
-- ponytail: counts hits seen on this machine; remote players' totals may be
-- lower than the host's. Upgrade path = Overlay's packet hooks (collector_damage.lua).
---------------------------------------------------------------------------
local damage = {}      -- [hunter address] = { name, self, damage }
local selfTarget       -- address of the monster the local player hit last

-- Support hunters (NPCs that fill an SOS) have no player name: read their NPC name instead
-- (Overlay data.lua GetHunterName: app.NpcUtil.getNpcName(NpcID) on the cNpcContextHolder).
local GetNpcName = sdk.find_type_definition("app.NpcUtil"):get_method("getNpcName(app.NpcDef.ID)")
local function isNpc(hunter) return hunter:get_HunterExtend():get_IsNpc() end
local function hunterName(hunter)
    local ext = hunter:get_HunterExtend()
    if ext:get_IsNpc() then
        local name = try("npcName", function() return GetNpcName:call(nil, ext:get_field("_ContextHolder"):get_Npc().NpcID) end)
        return type(name) == "string" and name ~= "" and name or nil -- anything else → caller uses "NPC"
    end
    return ext:get_field("_ContextHolder"):get_Pl():get_PlayerName()
end

-- Palico name: our own → network manager's palico name; others → "<owner> (Palico)" (Overlay data.lua GetOtomoName)
local function palicoInfo(otomo)
    local owner = otomo:get_OwnerHunterCharacter()
    local ownerName = safe(hunterName, owner) or "Hunter"
    if owner:get_IsMaster() then
        return safe(function() return Core.GetNetworkManager():SelfOtomoName() end) or (ownerName .. " (Palico)"), ownerName
    end
    return ownerName .. " (Palico)", ownerName
end

-- One hit on a large monster by a hunter or a palico. Read-only: only looks at the HitInfo.
local EnemyType = Core.Typeof("app.EnemyCharacter")
local function recordHit(attacker, hit, newRecord)
    if not attacker or not hit then return end
    local dmg = hit:get_DamageData()
    if not dmg or dmg:get_type_definition():get_name() ~= "cDamageParamEm" then return end
    local final = dmg:get_field("FinalDamage")
    if not final or final <= 0 then return end
    local enemy = hit:get_DamageOwner():getComponent(EnemyType)
    if not enemy then return end
    local ctx = enemy._Context._Em
    if not ctx:get_IsBoss() then return end

    local key = addr(attacker)
    local rec = damage[key]
    if not rec then
        rec = newRecord(attacker)
        rec.damage, rec.hits, rec.crits, rec.weakHits = 0, 0, 0, 0
        damage[key] = rec
    end
    rec.damage = rec.damage + final
    rec.hits = rec.hits + 1
    -- crit / weak-spot flags: same fields Overlay data.lua HandleHitData reads (CriticalType: 1 = Critical)
    if try("crit", function() return hit:get_AttackData()._CriticaType end) == 1 then rec.crits = rec.crits + 1 end
    if try("weakHit", function() return dmg.IsHitWeakPoint_Parts or dmg.IsHitWeakPoint_Scar end) then rec.weakHits = rec.weakHits + 1 end
    if rec.self then selfTarget = addr(ctx) end
end

sdk.hook(sdk.find_type_definition("app.HunterCharacter"):get_method("evHit_AttackPostProcess(app.HitInfo)"),
function(args)
    pcall(recordHit, sdk.to_managed_object(args[2]), sdk.to_managed_object(args[3]), function(hunter)
        local npc = safe(isNpc, hunter) == true
        return { name = safe(hunterName, hunter) or (npc and "NPC" or "Hunter"), self = hunter:get_IsMaster(), npc = npc or nil }
    end)
end)

-- Palico hits (Overlay collector_damage.lua hooks the same method on app.OtomoCharacter)
sdk.hook(sdk.find_type_definition("app.OtomoCharacter"):get_method("evHit_AttackPostProcess(app.HitInfo)"),
function(args)
    pcall(recordHit, sdk.to_managed_object(args[2]), sdk.to_managed_object(args[3]), function(otomo)
        local name, owner = palicoInfo(otomo)
        return { name = name, palico = true, owner = owner, self = false }
    end)
end)

---------------------------------------------------------------------------
-- Monsters
---------------------------------------------------------------------------
-- ponytail: getActiveQuestTargetBossList leaks a little per call (noted in
-- MHWilds Overlay), so the list is refreshed every 5s, not every tick.
local bosses, bossesAt = {}, -100

local partInfoCache = {}  -- [emID] = { [partIndex] = {name, kind} }
local function partInfo(ctx, emID)
    local cached = partInfoCache[emID]
    if cached then return cached end
    cached = {}
    local names = Core.GetEnumMap("app.EnemyDef.PARTS_TYPE")
    Core.ForEach(ctx.Parts._ParamParts._PartsArray._DataArray, function(param, i)
        local t = Core.FixedToEnum("app.EnemyDef.PARTS_TYPE", param._PartsType._Value)
        local enumName = string.lower(tostring(names[t] or ""))
        local kind = "other"
        if enumName:find("head") then kind = "head"
        elseif enumName:find("wing") then kind = "wing"
        elseif enumName:find("tail") then kind = "tail"
        elseif enumName:find("leg") or enumName:find("arm") or enumName:find("foot") then kind = "leg" end
        cached[i] = { name = Core.GetPartTypeName(t) or enumName, kind = kind }
    end)
    partInfoCache[emID] = cached
    return cached
end

-- Breakable part index → broken? (logic from Overlay boss/data.lua InitSeverableCache)
local function breakable(parts)
    local result = {}
    local link = parts._ParamParts._LinkPartsIndexByBreakParts
    Core.ForEach(parts._BreakParts, function(bp, bi)
        local broken = bp:get_IsBreak()
        Core.ForEach(link:get_Item(bi), function(index)
            result[index] = broken or result[index] == true
        end)
    end)
    return result
end

-- Current hitzone of one damage part. The meat slot changes when a part breaks or is wounded,
-- so this is the live value. Chain copied from Overlay boss/data.lua doUpdateEnemyCtx.
local MEAT_GUID = { [0] = "_MeatGuidNormal", [1] = "_MeatGuidBreak", [2] = "_MeatGuidCustom1", [3] = "_MeatGuidCustom2", [4] = "_MeatGuidCustom3" }
local NullableInt = sdk.find_type_definition("System.Nullable`1<System.Int32>")
local NullHas, NullVal = NullableInt:get_field("_HasValue"), NullableInt:get_field("_Value")

local function partMeat(params, part, i)
    local field = MEAT_GUID[part._MeatSlot]
    if not field then return nil end
    local guid = params._PartsArray._DataArray:get_Item(i):get_field(field)
    local idx = params:call("getMeatIndex(System.Guid)", guid)
    if not idx or not NullHas:get_data(idx) then return nil end
    local meat = params._MeatArray._DataArray:get_Item(NullVal:get_data(idx))
    if not meat then return nil end
    return {
        slash = meat._Slash, blow = meat._Blow, shot = meat._Shot,
        fire = meat._Fire, water = meat._Water, thunder = meat._Thunder, ice = meat._Ice, dragon = meat._Dragon,
    }
end

-- parts = breakable parts (part panel), hitzones = every damage part (weak spots / elements)
local function readParts(ctx, emID, m)
    local parts = ctx.Parts
    local params = parts._ParamParts
    local info = partInfo(ctx, emID)
    local brk = breakable(parts)
    Core.ForEach(parts._DmgParts, function(part, i)
        local pi = info[i] or { name = "Part " .. i, kind = "other" }
        local meat = try("hitzones", partMeat, params, part, i)
        if meat then
            meat.id, meat.name, meat.kind = tostring(i), pi.name, pi.kind
            table.insert(m.hitzones, meat)
        end
        local broken = brk[i]
        if broken == nil then return end
        table.insert(m.parts, {
            id = tostring(i), name = pi.name, kind = pi.kind,
            hp = part:get_Value(), hpMax = part:get_DefaultValue(), broken = broken,
        })
    end)
end

local function activeRemain(cond)
    return math.max(0, cond:get_ActivateTime() - cond:get_CurrentTimer())
end

local readCondition -- one condition; errors are isolated so a bad one doesn't hide the rest
local function readConditions(ctx, m)
    Core.ForEach(ctx.Conditions._Conditions, function(cond) try("condition", readCondition, cond, m) end)
end

readCondition = function(cond, m)
    local td = cond:get_type_definition()
    local name = td:get_name()
    if name == "cEnemyAngryCondition" then
        if cond:get_IsActive() then
            m.enraged = true
            m.enrageRemainSec = activeRemain(cond)
        end
    elseif name == "cEnemyTiredCondition" then
        -- exhaust: bar = stamina used up (Overlay boss/data.lua doUpdateEnemyActivateValueBase)
        local active = cond:get_IsActive()
        local max = cond:get_DefaultStamina()
        table.insert(m.ailments, {
            id = "exhaust", active = active, procs = safe(function() return cond._Count end) or 0,
            buildup = active and 1 or (max > 0 and 1 - cond:get_Stamina() / max or 0),
            remainSec = active and activeRemain(cond) or nil,
        })
    else
        local t
        if td:is_a("app.cEnemyBadCondition") then t = cond._ConditionType
        elseif td:is_a("app.cEnemyTrapCondition") then t = cond._Condition end
        local id = t and AILMENTS[t]
        if id then
            local active = cond:get_IsActive()
            table.insert(m.ailments, {
                id = id, active = active, procs = cond._Count or 0,
                buildup = active and 1 or cond:get_ValueRate(),
                remainSec = active and activeRemain(cond) or nil,
            })
        end
    end
end

-- app.cEmModuleScar.cScarParts.STATE (Enums_Internal.hpp): NONE -1, NORMAL 0, TEAR 1, RAW 2, OLD 3, HEAL 4.
-- Only TEAR/RAW are open wounds: a recording showed ~20 slots per monster sitting in NORMAL from quest start.
local SCAR_STATE = { [1] = "tear", [2] = "raw" }
local function readScars(ctx, emID)
    local out = {}
    local info = partInfo(ctx, emID)
    Core.ForEach(ctx.Scar:get_ScarParts(), function(scar)
        local state = SCAR_STATE[scar._State]
        if not state then return end
        local pi = info[scar._PartsIndex_1]
        table.insert(out, {
            part = pi and pi.name or nil, partId = tostring(scar._PartsIndex_1), state = state,
            legendary = scar._IsLegendary == true, ride = scar._IsRideScar == true,
        })
    end)
    return out
end

-- ponytail: getModelScale_Boss() unit is unverified (Overlay only prints it in debug).
-- Accept it only when it looks like a ratio or a percent; otherwise hide it (spec §9).
local function sizePct(ctx)
    local s = ctx:getModelScale_Boss()
    if type(s) ~= "number" then return nil end
    if s > 0.5 and s < 2 then return math.floor(s * 100 + 0.5) end
    if s > 50 and s < 200 then return math.floor(s + 0.5) end
    return nil
end



local function readMonster(enemy)
    local ctx = enemy._Context._Em
    local emID = ctx:get_EmID()
    local hpMgr = enemy:get_HealthMgr()
    local m = {
        id = addr(ctx),
        name = Core.GetEnemyName(emID) or ("EM " .. emID),
        hp = hpMgr:get_Health(),
        hpMax = hpMgr:get_MaxHealth(),
        enraged = false,
        ailments = {},
        parts = {},
        hitzones = {},
    }
    local rate = safe(function() return ctx.Dying:get_CaptureVitalRate() end)
    if type(rate) == "number" and rate > 0 and rate < 1 then m.captureThreshold = rate end
    -- captured monsters keep HP > 0; Overlay boss/draw.lua uses the same getter
    m.captured = safe(function() return ctx:get_Browser():get_IsCapture() end) == true or nil
    m.crown = CROWNS[safe(function() return ctx:get_Browser():checkCrownType() end) or 0]
    m.sizePct = safe(sizePct, ctx)
    m.scars = try("scars", readScars, ctx, emID)
    m.wounds = m.scars and #m.scars or nil
    safe(readParts, ctx, emID, m)
    safe(readConditions, ctx, m)
    return m
end

---------------------------------------------------------------------------
-- Player buffs
---------------------------------------------------------------------------
local function readBuffs()
    local out = {}
    local hunter = Core.GetPlayerCharacter()
    if not hunter then return out end
    local item = hunter:get_HunterStatus()._ItemBuff
    for _, b in ipairs(ITEM_BUFFS) do
        local timer, max
        if b.sub then
            local s = item:get_field(b.sub)
            if s then timer, max = s._Timer, s._MaxTime end
        else
            timer, max = item:get_field(b.timer), item:get_field(b.max)
        end
        if type(timer) == "number" and timer > 0 then
            -- ponytail: a non-positive max is treated as "no expiry" (∞); unverified per item
            local infinite = type(max) == "number" and max <= 0
            table.insert(out, { id = b.id, name = Core.GetItemName(b.item) or b.id, remainSec = (not infinite) and timer or nil })
        end
    end
    -- mantles / active skills and hunting-horn songs; each source isolated so one failing keeps the rest
    try("mantle", function()
        -- app.mcActiveSkillController._ActiveSkills: get_IsUse / get_Timer (Overlay status/data.lua UpdateASkill)
        -- in use → effect time left; not usable yet → cooldown left (get_IsCanUseTrigger false, Overlay UpdateASkill)
        Core.ForEach(hunter:get_ASkillController()._ActiveSkills, function(askill, i)
            local using, cooling = askill:get_IsUse(), not askill:get_IsCanUseTrigger()
            if using or cooling then
                local t = askill:get_Timer()
                if type(t) == "number" and t > 0 then
                    table.insert(out, { id = "askill_" .. i, kind = "mantle", name = Core.GetASkillName(i) or ("Mantle " .. i),
                        remainSec = t, cooldown = (not using) or nil })
                end
            end
        end)
    end)
    try("songs", function()
        -- cHunterSkill._Wp05MusicSkill._SkillTimer[i] = seconds left of horn song i (Overlay UpdateHunterSkills)
        Core.ForEach(hunter:get_HunterStatus()._Skill._Wp05MusicSkill._SkillTimer, function(timer, i)
            if type(timer) == "number" and timer > 0 then
                table.insert(out, { id = "song_" .. i, kind = "song", name = Core.GetMusicSkillName(i) or ("Song " .. i), remainSec = timer })
            end
        end)
    end)
    return out
end

-- Our HP (incl. red/recoverable) and stamina — app.cHunterHealth / app.cHunterStamina getters used by Overlay
local function readVitals()
    local hunter = Core.GetPlayerCharacter()
    if not hunter then return nil end
    local v = {}
    try("health", function()
        local h = hunter:get_HunterHealth()
        local mgr = h:get_HealthMgr()
        v.hp, v.hpMax, v.hpRed = mgr:get_Health(), mgr:get_MaxHealth(), h:get_RedHealth()
    end)
    try("stamina", function()
        local s = hunter:get_HunterStamina()
        v.stamina, v.staminaMax = s:get_Stamina(), s:get_MaxStamina()
    end)
    return v
end

---------------------------------------------------------------------------
-- Hunter profile (the "นักล่า" tab): HR, weapon, active skills. Changes rarely → read every 2s.
-- getHunterRank() = Overlay data.lua GetMasterPlayerHR; getSkillLevel = Overlay status/data.lua
---------------------------------------------------------------------------
local WeaponNames = Core.GetEnumMap("app.WeaponDef.TYPE")
local GetHR = sdk.find_type_definition("app.BasicParamUtil"):get_method("getHunterRank()")
local GetSkillLevel = sdk.find_type_definition("app.cHunterSkill"):get_method("getSkillLevel(app.HunterDef.Skill, System.Boolean, System.Boolean)")
local SkillIds = Core.GetEnumMap("app.HunterDef.Skill")
local PROFILE_EVERY = 2
local profile, profileAt = nil, -100

local function readSkills(hunter)
    local out = {}
    local skill = hunter:get_HunterStatus()._Skill
    for id, enumName in pairs(SkillIds) do
        -- the enum also has NONE/MAX values: guard each call so one bad id never drops the list
        local lv = type(id) == "number" and id > 0 and enumName ~= "MAX" and safe(GetSkillLevel.call, GetSkillLevel, skill, id, false, false)
        if type(lv) == "number" and lv > 0 then
            table.insert(out, { id = enumName, name = safe(Core.GetSkillName, id) or enumName, lv = lv,
                max = safe(Core.GetEquipSkillMaxLevel, id) or nil })
        end
    end
    table.sort(out, function(a, b) if a.lv ~= b.lv then return a.lv > b.lv end return a.name < b.name end)
    return out
end

local function readProfile()
    local hunter = Core.GetPlayerCharacter()
    if not hunter then return nil end
    local wp = Core.GetPlayerWeaponType()
    return {
        name = safe(hunterName, hunter),
        hr = try("hr", function() return GetHR:call(nil) end),
        weapon = wp and { type = WeaponNames[wp], name = safe(Core.GetWeaponTypeName, wp) } or nil,
        skills = try("skills", readSkills, hunter) or {},
    }
end

---------------------------------------------------------------------------
-- Snapshot (spec §3 data contract)
---------------------------------------------------------------------------
local wasActive = false

function M.snapshot()
    local active = Core.IsActiveQuest()
    if active and not wasActive then
        damage, selfTarget, bossesAt = {}, nil, -100 -- new quest: reset meter + boss list
    end
    wasActive = active

    local snap = { v = 1, ts = os.time() * 1000, connected = true, monsters = {}, party = {} }

    if not active then
        snap.quest = { active = false, elapsedSec = 0, limitSec = 0 }
    else
        -- getActiveTimeLimit() is in MINUTES (a recording showed 50 for a 50-minute quest);
        -- elapsed is in seconds, so remaining time is computed here instead of trusting another getter.
        local elapsed = Core.GetQuestElapsedTime()
        local limitSec = (Core.GetQuestTimeLimit() or 0) * 60
        snap.quest = {
            active = true,
            elapsedSec = elapsed,
            limitSec = limitSec,
            remainSec = limitSec > 0 and math.max(0, limitSec - elapsed) or nil,
        }
        local now = Core.GetTime() -- via.Application uptime seconds
        if now - bossesAt > 5 then
            bosses = Core.GetQuestBossList() or {}
            bossesAt = now
        end
        for _, enemy in ipairs(bosses) do
            local m = try("monster", readMonster, enemy)
            if m then table.insert(snap.monsters, m) end
        end
        snap.targetId = selfTarget
    end

    -- weapon type name decides which hitzone (slash/blow/shot) the UI ranks weak spots by.
    -- app.WeaponDef.TYPE names (Enums_Internal.hpp): LONG_SWORD, HAMMER, WHISTLE, GUN_LANCE, BOW, …; nil → UI uses the best of the three
    snap.player = {
        buffs = try("buffs", readBuffs) or {},
        weapon = try("weapon", function() return WeaponNames[Core.GetPlayerWeaponType()] end),
        vitals = readVitals(),
    }
    for key, rec in pairs(damage) do
        -- id = the character's address: tells apart players with the same name ("Hunter")
        table.insert(snap.party, { id = key, name = rec.name, self = rec.self, npc = rec.npc, palico = rec.palico, owner = rec.owner,
            damage = math.floor(rec.damage), hits = rec.hits, crits = rec.crits, weakHits = rec.weakHits })
    end
    local now = Core.GetTime()
    if now - profileAt >= PROFILE_EVERY then
        profile, profileAt = try("profile", readProfile), now
    end
    snap.profile = profile
    if next(errors) then snap.errors = errors end
    return snap
end

return M
