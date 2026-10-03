"""Every analysis runs on a real (short) log, the tune plan and the comparison build, and the web API answers."""
import shutil

import pytest

import plan


def test_cli_pairs_reads_every_format():
    t = "Filter the D-term more (set dterm_lpf1_dyn_min_hz = 51, dterm_lpf1_dyn_max_hz = 102; set dterm_lpf2_static_hz = 128) or lower D."
    assert plan.cli_pairs(t) == [("dterm_lpf1_dyn_min_hz", "51"), ("dterm_lpf1_dyn_max_hz", "102"), ("dterm_lpf2_static_hz", "128")]
    assert plan.cli_pairs("set simplified_gyro_filter_multiplier = 85 (now 100)") == [("simplified_gyro_filter_multiplier", "85")]
    assert plan.cli_pairs("nothing to set here") == []


def test_all_analyses_run(short_lg):
    G = plan.gather(short_lg, 7.0, 2, 0.52)
    for k in ("noise", "step", "motors", "pid", "propwash", "fplan"):
        assert isinstance(G[k], dict), k
        assert not G[k].get("error"), f"{k}: {G[k].get('error')}"
    p = short_lg.profile(7.0, 2, None)
    assert 0.1 < p["used"]["auw_kg"] < 3


def test_tune_plan_is_ordered_and_consistent(short_lg):
    P = plan.build_plan(short_lg, 7.0, 2, None)
    order = [s["id"] for s in P["steps"]]
    assert order == ["log", "mech", "filters", "pids", "feel", "later"]
    assert all(i["step"] in order for i in P["items"])
    seen = {}
    for it in P["items"]:          # one value per setting among ticked items
        if it["on"]:
            for k, v in it["cli"]:
                assert seen.setdefault(k, v) == v, k
    assert P["checklist"]


def test_compare_same_flight_is_the_same(short_lg):
    G = plan.gather(short_lg, 7.0, 2, 0.52)
    C = plan.compare(short_lg, short_lg, G, G)
    assert C["n_better"] == 0 and C["n_worse"] == 0
    assert C["changed"] == []
    assert any("No tuning settings changed" in i["title"] for i in C["ideas"])


@pytest.fixture(scope="module")
def client(tmp_path_factory):
    pytest.importorskip("httpx")
    from fastapi.testclient import TestClient
    import app as appmod
    from conftest import DATA
    d = tmp_path_factory.mktemp("logs")
    shutil.copy(DATA / "short.bbl", d / "short.bbl")
    appmod.LOGS = d
    appmod._load.cache_clear()
    return TestClient(appmod.app)


def test_api_endpoints(client):
    assert any(l["name"] == "short.bbl" for l in client.get("/api/logs").json())
    m = client.get("/api/short.bbl/1/meta").json()
    assert m["units"]["step_dps"] == 1.0 and "debug" in m
    s = client.get("/api/short.bbl/1/series", params={"fields": "gyroADC[0],gyroUnfilt[0]", "t0": 5, "t1": 5.1, "smooth": 3}).json()
    assert len(s["t"]) == len(s["gyroADC[0]"]) > 50
    assert any(abs(v - round(v)) > 1e-6 for v in s["gyroADC[0]"])      # smoothing makes in-between values
    p = client.get("/api/short.bbl/1/plan", params={"prop": 7, "blades": 2}).json()
    assert p["steps"] and p["checklist"]
    c = client.get("/api/compare", params={"a": "short.bbl", "b": "short.bbl"}).json()
    assert c["headline"] == "About the same"
    assert client.get("/api/nope.bbl/1/meta").status_code == 404
