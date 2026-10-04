-- Probe for the "นักล่า" tab (phase 2): lists the fields/methods of the hunter status and the
-- current save data, so we can find equipped gear, attack/affinity and account stats.
-- Runs only when you press the button in the REFramework menu. Read-only: besides two getters
-- (status, current save) it only reads fields. Writes reframework/data/hunt_dashboard_probe.json.
-- Only numbers/booleans are written as values (no strings: names and IDs stay out of the file).
local Core = require("_CatLib")

local M = {}
local OUT = "hunt_dashboard_probe.json"

local function isObj(v) return type(v) == "userdata" and pcall(function() return v:get_type_definition() end) end

local function schema(obj, depth)
    local td = obj:get_type_definition()
    local out = { type = td:get_full_name(), fields = {}, methods = {} }
    local t = td
    while t and t:get_full_name() ~= "System.Object" and t:get_full_name() ~= "via.clr.ManagedObject" do
        for _, f in ipairs(t:get_fields()) do
            if not f:is_static() then
                local name = f:get_name()
                local ok, v = pcall(f.get_data, f, obj)
                local entry = { type = f:get_type():get_full_name() }
                if ok and (type(v) == "number" or type(v) == "boolean") then entry.value = v end
                if ok and depth > 0 and isObj(v) then
                    local good, child = pcall(schema, v, depth - 1)
                    entry.child = good and child or nil
                end
                out.fields[name] = entry
            end
        end
        for _, m in ipairs(t:get_methods()) do
            local name = m:get_name()
            if name:match("^get") or name:match("^is") or name:match("Equip") or name:match("Rank") or name:match("Time") then
                out.methods[#out.methods + 1] = name
            end
        end
        t = t:get_parent_type()
    end
    return out
end

function M.dump()
    local res = {}
    local hunter = Core.GetPlayerCharacter()
    if hunter then
        local ok, v = pcall(function() return schema(hunter:get_HunterStatus(), 1) end)
        res.hunterStatus = ok and v or tostring(v)
        ok, v = pcall(function() return schema(hunter, 0) end)
        res.hunter = ok and v or tostring(v)
    end
    local ok, v = pcall(function() return schema(Core.GetSaveDataManager():getCurrentUserSaveData(), 1) end)
    res.saveData = ok and v or tostring(v)
    json.dump_file(OUT, res)
    return OUT
end

return M
