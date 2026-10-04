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

local function hunterName(hunter)
    local ext = hunter:get_HunterExtend()
    if ext:get_IsNpc() then return nil end
    return ext:get_field("_ContextHolder"):get_Pl():get_PlayerName()
end

local EnemyType = Core.Typeof("app.EnemyCharacter")
sdk.hook(sdk.find_type_definition("app.HunterCharacter"):get_method("evHit_AttackPostProcess(app.HitInfo)"),
function(args)
    pcall(function()
        local hunter = sdk.to_managed_object(args[2])
        local hit = sdk.to_managed_object(args[3])
        if not hunter or not hit then return end
        local dmg = hit:get_DamageData()
        if not dmg or dmg:get_type_definition():get_name() ~= "cDamageParamEm" then return end
        local final = dmg:get_field("FinalDamage")
        if not final or final <= 0 then return end
        local enemy = hit:get_DamageOwner():getComponent(EnemyType)
        if not enemy then return end
        local ctx = enemy._Context._Em
        if not ctx:get_IsBoss() then return end

        local key = addr(hunter)
        local rec = damage[key]
        if not rec then
            rec = { name = safe(hunterName, hunter) or "Hunter", self = hunter:get_IsMaster(), damage = 0 }
            damage[key] = rec
        end
        rec.damage = rec.damage + final
        if rec.self then selfTarget = addr(ctx) end
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


-- English name whatever the game language is — the UI matches it against src/data/monsters.json.
-- Same call _CatLib/game/text.lua GetEnemyName makes, with an explicit language (1 = English, _CatLib.const LanguageType).
local EnemyNameGuid = sdk.find_type_definition("app.EnemyDef"):get_method("EnemyName(app.EnemyDef.ID)")
local nameEnCache = {}
local function nameEn(emID)
    if nameEnCache[emID] == nil then
        nameEnCache[emID] = try("nameEn", function() return Core.GetLocalizedText(EnemyNameGuid:call(nil, emID), 1) end) or false
    end
    return nameEnCache[emID] or nil
end

local function readMonster(enemy)
    local ctx = enemy._Context._Em
    local emID = ctx:get_EmID()
    local hpMgr = enemy:get_HealthMgr()
    local m = {
        id = addr(ctx),
        nameEn = nameEn(emID),
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
    return out
end

---------------------------------------------------------------------------
-- Snapshot (spec §3 data contract)
---------------------------------------------------------------------------
local wasActive = false
local WeaponNames = Core.GetEnumMap("app.WeaponDef.TYPE")

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
    }
    for _, rec in pairs(damage) do
        table.insert(snap.party, { name = rec.name, self = rec.self, damage = math.floor(rec.damage) })
    end
    if next(errors) then snap.errors = errors end
    return snap
end

return M
