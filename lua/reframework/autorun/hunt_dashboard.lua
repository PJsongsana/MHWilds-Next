-- Hunt Dashboard: writes a snapshot to reframework/data/hunt_dashboard.json
-- every ~200ms. The bridge (bridge/server.js) watches that file. Read-only.
local OUT = "hunt_dashboard.json"
local INTERVAL = 0.2

local ok, reader = pcall(require, "hunt_dashboard.game_reader")
local last = 0
-- os.clock() is CPU time (runs faster than wall time on a multi-threaded game)
local UpTime = sdk.find_type_definition("via.Application"):get_method("get_UpTimeSecond")

re.on_application_entry("UpdateBehavior", function()
    local now = UpTime:call(nil)
    if now - last < INTERVAL then return end
    last = now

    local snap
    if not ok then
        snap = { v = 1, ts = os.time() * 1000, connected = false, error = "load: " .. tostring(reader) }
    else
        local good, result = pcall(reader.snapshot)
        snap = good and result or { v = 1, ts = os.time() * 1000, connected = false, error = tostring(result) }
    end
    json.dump_file(OUT, snap)
end)

re.on_draw_ui(function()
    if imgui.tree_node("Hunt Dashboard") then
        imgui.text(ok and ("running -> reframework/data/" .. OUT) or ("error: " .. tostring(reader)))
        imgui.tree_pop()
    end
end)
