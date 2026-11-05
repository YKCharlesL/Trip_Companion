#!/usr/bin/env python3
"""End-to-end test: sample trip -> maps -> export -> app offline (iPhone + Android emulation).

Needs: pip install playwright && python -m playwright install chromium
Run:   python3 start.py --no-browser &   then   python3 tests/e2e_test.py
Emulation in Chromium is not a real iPhone; see README "Testing → On real phones".
"""
import json
import sys
import urllib.request

from playwright.sync_api import sync_playwright

B = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:8765"
GL = ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"]
failures = []


def check(cond, msg):
    print(("  ok   " if cond else "  FAIL ") + msg)
    if not cond:
        failures.append(msg)


def api(method, path, data=None):
    req = urllib.request.Request(B + path, method=method, data=json.dumps(data).encode() if data is not None else None,
                                 headers={"Content-Type": "application/json"})
    return json.load(urllib.request.urlopen(req))


def main():
    proj = api("POST", "/api/projects", {"template": "sample", "name": "E2E test trip"})
    pid = proj["id"]
    print("project", pid)
    with sync_playwright() as p:
        br = p.chromium.launch(args=GL)
        pg = br.new_page(viewport={"width": 1500, "height": 950})
        errors = []
        pg.on("pageerror", lambda e: errors.append(str(e)))
        pg.on("dialog", lambda d: d.accept())
        pg.goto(B + "/builder/")
        pg.evaluate(f"localStorage.setItem('tb-last', '{pid}')")
        pg.reload()
        pg.wait_for_function("document.querySelector('#save-status').textContent.startsWith('Saved')", timeout=60000)
        pg.wait_for_timeout(1500)
        for _ in range(60):  # PDF pages are rendered in the background after loading
            files = api("GET", f"/api/projects/{pid}")["files"]
            if all(m.get("pages") for m in files.values() if m["type"] == "pdf"):
                break
            pg.wait_for_timeout(1000)
        check(all(m.get("pages") for m in files.values() if m["type"] == "pdf"), "PDF pages rendered to images")

        # validation should flag a missing address
        pg.click("[data-page='section:restaurants']")
        pg.click("[data-cmd='add-entry']")
        pg.fill(".entry-card:last-child [data-f=title]", "Test café without address")
        pg.click("[data-page='export']")
        pg.wait_for_selector(".checks")
        check("has no address" in pg.inner_text(".checks"), "export checks warn about a missing address")
        pg.click("[data-page='section:restaurants']")
        pg.click(".entry-card:last-child [data-cmd='del-entry']")

        pg.click("[data-page='maps']")
        pg.check("[data-interactive]")
        pg.click("[data-cmd='render-maps']")
        pg.wait_for_function("document.querySelectorAll('.map-thumbs img').length > 0", timeout=240000)
        check(pg.locator(".map-thumbs img").count() >= 2, "overview and day maps drawn")
        pg.click("[data-page='export']")
        pg.click("#do-export")
        pg.wait_for_selector(".result", timeout=240000)
        site = pg.get_attribute(".result a[href*='/site/']", "href")
        single = pg.get_attribute(".result a[href$='-offline.html']", "href")
        check(not errors, "no JavaScript errors in the builder " + "; ".join(errors[:3]))
        br.close()

        for devname in ("iPhone 13", "Pixel 7"):
            print(devname)
            br = p.chromium.launch(args=GL)
            dev = {k: v for k, v in p.devices[devname].items() if k != "default_browser_type"}
            ctx = br.new_context(**dev, permissions=["geolocation"], geolocation={"latitude": 38.7139, "longitude": -9.1395})
            a = ctx.new_page()
            errs = []
            a.on("pageerror", lambda e: errs.append(str(e)))
            a.goto(B + site)
            a.wait_for_function("document.querySelector('#toast').textContent.includes('Ready for offline')", timeout=60000)
            check(True, "'Ready for offline' shown after first load")
            n_cached = a.evaluate("caches.open('trip-' + TRIP_VERSION).then(c => c.keys()).then(k => k.length)")
            check(n_cached > 30, f"service worker precached {n_cached} files")
            ctx.set_offline(True)
            a.reload()
            a.wait_for_selector(".countdown")
            check("Offline" in a.inner_text("#statusbar"), "offline indicator shown")
            a.goto(B + site + "#/entry/insdoc")
            a.click(".doc-tile")
            a.wait_for_timeout(1000)
            widths = a.evaluate("[...document.querySelectorAll('.viewer img')].map(i => i.naturalWidth)")
            check(widths and min(widths) >= 2000, f"PDF opens offline as full-resolution pages {widths}")
            check(a.locator("text=Open PDF").count() == 0, "no 'Open PDF' download button")
            a.goto(B + site + "#/section/tours")
            check(a.inner_text(".page-title").strip().endswith("Tours"), "section is called 'Tours'")
            check(a.locator("text=Show on map").count() == 0, "no 'Show on map' on events")
            a.click(".entry >> text=Say it")
            a.wait_for_timeout(500)
            check(a.locator(".place-phrase").count() == 2 and "leve-me" in (a.locator(".btn-play").first.get_attribute("data-speak") or ""),
                  "event 'Say it' shows both place phrases, spoken fully in Portuguese")
            a.goto(B + site + "#/map")
            titles = a.locator(".map-card h3").all_inner_texts()
            check(titles and titles[-1].startswith("Overview"), "overview map is last")
            a.set_viewport_size({"width": 320, "height": 568})
            a.goto(B + site + "#/home")
            a.wait_for_timeout(500)
            lay = a.evaluate("({w: document.documentElement.clientWidth, sw: document.documentElement.scrollWidth, tiles: new Set([...document.querySelectorAll('.tile')].map(t => Math.round(t.getBoundingClientRect().width))).size, nav: Math.round(document.querySelector('.bottom-nav').getBoundingClientRect().bottom), vh: innerHeight})")
            check(lay["sw"] == lay["w"] and lay["tiles"] == 1 and lay["nav"] == lay["vh"], f"home: no sideways scroll, equal tiles, bottom bar fully visible at 320 px {lay}")
            a.set_viewport_size(dev["viewport"])
            a.goto(B + site + "#/livemap/hotel")
            a.wait_for_selector(".lm-pin", timeout=30000)
            a.wait_for_timeout(2500)
            check(a.locator(".lm-pin").count() >= 10, "moving map shows numbered pins offline")
            check(a.locator(".lm-me").count() == 1, "'You are here' GPS dot shown")
            a.screenshot(path=f"tests/out-livemap-{devname.split()[0]}.png")
            a.goto(B + site + "#/say/p/ph6")
            check("casa de banho" in a.inner_text(".pb-local"), "phrase card shows local text")
            a.goto(B + site + "#/help")
            check(a.get_attribute(".sos", "href") == "tel:112", "emergency button dials 112")
            check(a.inner_text(".sos").split() == ["112", "Emergency"] and "No internet" not in a.inner_text("#view"), "Help: '112 Emergency', no extra cards")
            sizes = a.evaluate("Math.min(...[...document.querySelectorAll('#view *')].filter(e => e.offsetParent && [...e.childNodes].some(n => n.nodeType === 3 && n.textContent.trim())).map(e => parseFloat(getComputedStyle(e).fontSize)))")
            check(sizes >= 19, f"smallest text is {sizes}px (min 19)")
            check(not errs, "no JavaScript errors in the app " + "; ".join(errs[:3]))
            br.close()

        # update flow: change a title, re-export, the open app updates itself
        print("update")
        br = p.chromium.launch(args=GL)
        ctx = br.new_context(**{k: v for k, v in p.devices["Pixel 7"].items() if k != "default_browser_type"})
        a = ctx.new_page()
        a.goto(B + site)
        a.wait_for_function("document.querySelector('#toast').textContent.includes('Ready for offline')", timeout=60000)
        b = br.new_page(viewport={"width": 1500, "height": 950})
        b.on("dialog", lambda d: d.accept())
        b.goto(B + "/builder/")
        b.click(f"[data-open='{pid}']")  # a fresh browser starts on the start screen
        b.wait_for_function("document.querySelector('#save-status').textContent.startsWith('Saved')", timeout=60000)
        b.click("[data-page='settings']")
        b.fill("[data-s=tripName]", "E2E test trip (updated)")
        b.wait_for_timeout(1200)
        b.click("[data-page='export']")
        b.click("#do-export")
        b.wait_for_selector(".result", timeout=240000)
        new_site = b.get_attribute(".result a[href*='/site/']", "href")
        a.goto(B + new_site)
        a.wait_for_function("document.querySelector('.hero h1') && document.querySelector('.hero h1').textContent.includes('updated')", timeout=60000)
        check(True, "re-export reaches the phone on the next online visit")
        br.close()

        print("single file")
        br = p.chromium.launch()
        c = br.new_context(java_script_enabled=False)
        s = c.new_page()
        s.goto(B + single)
        check(s.locator("#static-doc img").count() > 5 and "Emergency" in s.inner_text(".sos"), "single file readable without JavaScript (iPhone Quick Look)")
        c2 = br.new_context()
        s2 = c2.new_page()
        s2.goto(B + single)
        s2.wait_for_selector(".bottom-nav")
        check(True, "single file becomes the full app where JavaScript runs")
        br.close()
    api("DELETE", f"/api/projects/{pid}")
    print("\n" + ("ALL PASSED" if not failures else f"{len(failures)} FAILED"))
    sys.exit(1 if failures else 0)


if __name__ == "__main__":
    main()
