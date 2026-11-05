#!/usr/bin/env python3
"""Regenerate the demo trip (sample-project.json + files/). Needs reportlab and Pillow.

All documents are fake and marked DEMO / SPECIMEN. Dates are stored as "+N" (days after
tomorrow) and converted to real dates when you click "Load sample trip".
"""
import json
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.pdfgen import canvas

HERE = Path(__file__).resolve().parent
FILES = HERE / "files"


def font(size, bold=False):
    for name in (["DejaVuSans-Bold.ttf", "Arial Bold.ttf"] if bold else ["DejaVuSans.ttf", "Arial.ttf"]):
        try:
            return ImageFont.truetype(name, size)
        except OSError:
            continue
    return ImageFont.load_default()


def pdf(name, title, lines, pages=1, color=(0.04, 0.36, 0.68)):
    c = canvas.Canvas(str(FILES / name), pagesize=A4)
    w, h = A4
    for p in range(pages):
        c.setFillColorRGB(*color)
        c.rect(0, h - 40 * mm, w, 40 * mm, fill=1, stroke=0)
        c.setFillColorRGB(1, 1, 1)
        c.setFont("Helvetica-Bold", 24)
        c.drawString(20 * mm, h - 22 * mm, title)
        c.setFont("Helvetica", 12)
        c.drawString(20 * mm, h - 32 * mm, f"DEMO DOCUMENT - not valid for travel   ·   page {p + 1} of {pages}")
        c.setFillColorRGB(0, 0, 0)
        y = h - 60 * mm
        for line in (lines if p == 0 else [f"Passenger {p + 1}", "Seat 14C", "Baggage: 1 x 23 kg", "Boarding closes 30 min before departure"]):
            bold = line.startswith("*")
            c.setFont("Helvetica-Bold" if bold else "Helvetica", 15 if bold else 13)
            c.drawString(20 * mm, y, line.lstrip("*"))
            y -= 9 * mm
        c.saveState()
        c.setFillColorRGB(0.85, 0.1, 0.1)
        c.setFont("Helvetica-Bold", 70)
        c.translate(w / 2, h / 2 - 40 * mm)
        c.rotate(30)
        c.setFillAlpha(0.15)
        c.drawCentredString(0, 0, "DEMO")
        c.restoreState()
        c.showPage()
    c.save()


def card_image(name, title, lines, size=(1600, 1050), bg=(214, 228, 245), fmt="JPEG"):
    im = Image.new("RGB", size, bg)
    d = ImageDraw.Draw(im)
    d.rectangle([0, 0, size[0], 150], fill=(20, 60, 120))
    d.text((50, 45), title, fill="white", font=font(64, True))
    d.rectangle([60, 210, 460, 720], fill=(170, 180, 195))
    d.ellipse([170, 280, 350, 460], fill=(140, 150, 165))
    d.rectangle([140, 470, 380, 700], fill=(140, 150, 165))
    y = 220
    for line in lines:
        d.text((520, y), line, fill=(20, 20, 20), font=font(46, line.isupper()))
        y += 80
    d.text((300, 820), "SPECIMEN  ·  DEMO ONLY", fill=(200, 30, 30), font=font(80, True))
    im.save(FILES / name, fmt, quality=88)


def main():
    FILES.mkdir(exist_ok=True)
    for f in FILES.iterdir():
        f.unlink()
    pdf("s-eticket.pdf", "E-ticket · TP 781 / TP 780", [
        "*Stockholm Arlanda (ARN) -> Lisbon (LIS)", "Day 1 · departs 07:05 (Stockholm time) · arrives 09:50 (Lisbon time)",
        "*Lisbon (LIS) -> Stockholm Arlanda (ARN)", "Day 5 · departs 14:20 · arrives 19:55 (Stockholm time)",
        "Booking reference: DEMO7Q", "Passengers: Mum, Dad"], pages=2)
    pdf("s-hotel.pdf", "Hotel booking confirmation", [
        "*Hotel Avenida Palace (demo booking)", "Rua 1º de Dezembro 123, 1200-359 Lisboa", "Check-in from 15:00 · Check-out by 11:00",
        "Double room, breakfast included", "Confirmation number: HAP-DEMO-4471"], color=(0.11, 0.30, 0.85))
    pdf("s-tram-voucher.pdf", "Tour voucher · Tram 28 tour", [
        "*Meeting point: Praça Martim Moniz, by the tram stop", "Start 10:00 · duration 2 hours",
        "Guide speaks English · look for the yellow umbrella", "Voucher: T28-DEMO-019"], color=(0.49, 0.13, 0.81))
    pdf("s-insurance.pdf", "Travel insurance certificate", [
        "*Demo Travel Insurance AB", "Policy number: DEMO-123456", "Covers: medical care, transport home, cancellation",
        "Claims line (24 h): see the app's Help screen", "Keep this certificate with you"], color=(0.12, 0.47, 0.24))
    card_image("s-passport-mum.jpg", "PASSPORT · SPECIMEN", ["SURNAME / GIVEN NAMES", "Mum Example", "No. XX0000001", "Valid to 2031"])
    card_image("s-passport-dad.jpg", "PASSPORT · SPECIMEN", ["SURNAME / GIVEN NAMES", "Dad Example", "No. XX0000002", "Valid to 2030"])
    card_image("s-vivaviagem.png", "Viva Viagem card", ["Top up at metro machines", "Tram, metro and bus", "Keep it - it is reusable"],
               size=(1200, 760), bg=(220, 240, 220), fmt="PNG")

    def E(id, title, **kw):
        e = {"id": id, "title": title, "files": kw.pop("files", [])}
        e.update(kw)
        return e

    sections = {
        "accommodation": [
            E("hotel", "Hotel Avenida Palace", details="Double room with breakfast (07:00–10:30). Reception is open 24 hours.",
              date="+0", time="15:00", endDate="+4", endTime="11:00",
              address="Rua 1º de Dezembro 123\n1200-359 Lisboa", lat=38.714763, lng=-9.141098, pinSource="geocode",
              phone="+351 21 000 0001", ref="HAP-DEMO-4471", notes="Say your surname at reception. The room is paid.",
              files=["s-hotel.pdf"]),
        ],
        "tours": [
            E("tram", "Tram 28 guided tour", localName="Praça Martim Moniz", details="Two hours on the famous yellow tram with an English-speaking guide.",
              date="+1", time="10:00", endTime="12:00", address="Praça Martim Moniz\n1100-341 Lisboa", lat=38.715997, lng=-9.136346, pinSource="geocode",
              ref="T28-DEMO-019", notes="Look for the guide with the yellow umbrella next to the tram stop. 5 minutes' walk from the hotel.",
              files=["s-tram-voucher.pdf"]),
            E("fado", "Fado dinner and show", localName="Clube de Fado", details="Traditional Portuguese music with dinner.",
              date="+1", time="20:00", address="Rua de São João da Praça 94\n1100-521 Lisboa", lat=38.709639, lng=-9.131199, pinSource="geocode",
              phone="+351 21 000 0002", ref="FADO-DEMO-77", notes="Take a taxi from the hotel (about 10 minutes)."),
            E("belemtour", "Belém walking tour", localName="Padrão dos Descobrimentos", details="Monuments of the Age of Discovery. Easy walking, flat.",
              date="+2", time="10:00", endTime="12:00", address="Padrão dos Descobrimentos\nAvenida Brasília, 1400-038 Lisboa", lat=38.693605, lng=-9.205695,
              pinSource="geocode", ref="BEL-DEMO-311", notes="Tram 15 from Praça da Figueira, or a taxi (about 15 minutes)."),
        ],
        "travel": [
            E("flyout", "Flight to Lisbon · TP 781", details="Stockholm Arlanda (ARN) → Lisbon (LIS). Arrives 09:50 Lisbon time. Check in 2 hours before.",
              date="+0", time="07:05", tz="Europe/Stockholm", address="Aeroporto Humberto Delgado\nAlameda das Comunidades Portuguesas, 1700-111 Lisboa",
              lat=38.780998, lng=-9.131861, pinSource="geocode", ref="DEMO7Q", notes="Taxi from the airport to the hotel: about 20 minutes, around 15–20 euros.",
              files=["s-eticket.pdf"]),
            E("flyhome", "Flight home · TP 780", details="Lisbon (LIS) → Stockholm Arlanda (ARN). Arrives 19:55 Stockholm time. Leave the hotel by 11:30.",
              date="+4", time="14:20", address="Aeroporto Humberto Delgado\nAlameda das Comunidades Portuguesas, 1700-111 Lisboa",
              lat=38.780998, lng=-9.131861, pinSource="geocode", ref="DEMO7Q", files=["s-eticket.pdf"]),
        ],
        "restaurants": [
            E("ramiro", "Cervejaria Ramiro", details="Famous seafood restaurant. Table booked.", date="+0", time="19:30",
              address="Avenida Almirante Reis 1\n1150-007 Lisboa", lat=38.72136, lng=-9.135407, pinSource="geocode",
              phone="+351 21 000 0003", ref="Table for 2 · name: Example"),
            E("pasteis", "Pastéis de Belém", details="The original custard tarts. No booking: the queue moves fast.", date="+2", time="12:30",
              address="Rua de Belém 84-92\n1300-085 Lisboa", lat=38.69748, lng=-9.20332, pinSource="geocode"),
            E("timeout", "Time Out Market", details="Big food hall with many small kitchens. Easy lunch, lots of seats.", date="+3", time="13:30",
              address="Avenida 24 de Julho 49\n1200-479 Lisboa", lat=38.706994, lng=-9.145693, pinSource="geocode"),
        ],
        "sightseeing": [
            E("castelo", "São Jorge Castle", localName="Castelo de São Jorge", details="Castle with the best view over Lisbon. Steep cobbles: take tram 28 or a taxi up.",
              date="+1", time="14:00", address="Rua de Santa Cruz do Castelo\n1100-129 Lisboa", lat=38.713926, lng=-9.133483, pinSource="geocode",
              ref="Tickets: buy at the gate (senior discount)"),
            E("luzia", "Santa Luzia viewpoint", localName="Miradouro de Santa Luzia", details="Viewpoint with tiles and benches, on the way down from the castle.",
              date="+1", time="16:30", address="Largo de Santa Luzia\n1100-487 Lisboa", lat=38.711738, lng=-9.13013, pinSource="geocode"),
            E("jeronimos", "Jerónimos Monastery", localName="Mosteiro dos Jerónimos", details="Beautiful monastery. Closed on Mondays.", date="+2", time="13:30",
              address="Praça do Império\n1400-206 Lisboa", lat=38.697758, lng=-9.206624, pinSource="geocode"),
            E("torre", "Belém Tower", localName="Torre de Belém", details="Tower by the river. You can just look from outside.", date="+2", time="15:30",
              address="Avenida Brasília\n1400-038 Lisboa", lat=38.691586, lng=-9.215929, pinSource="geocode"),
            E("oceanario", "Lisbon Oceanarium", localName="Oceanário de Lisboa", details="Large aquarium. Lifts everywhere, many benches.", date="+3", time="10:30",
              address="Esplanada Dom Carlos I\n1990-005 Lisboa", lat=38.76352, lng=-9.093716, pinSource="geocode", ref="OCE-DEMO-5512",
              notes="Metro red line to Oriente, or a taxi (about 20 minutes)."),
        ],
        "documents": [
            E("passports", "Passport copies", details="Copies only: keep the real passports in the hotel safe.", files=["s-passport-mum.jpg", "s-passport-dad.jpg"]),
            E("insdoc", "Travel insurance certificate", ref="DEMO-123456", files=["s-insurance.pdf"]),
            E("tickets", "Flight e-tickets", ref="DEMO7Q", files=["s-eticket.pdf"]),
        ],
        "tips": [
            E("tip-cobbles", "Pavements are slippery", details="Lisbon's stone pavements (calçada) are steep and slippery, especially when wet. Wear shoes with good grip and use the trams and taxis for hills."),
            E("tip-transport", "Tram, metro and bus card", details="Buy a “Viva Viagem” card at any metro station machine and top it up. One card per person.", files=["s-vivaviagem.png"]),
            E("tip-water", "Water and tipping", details="Tap water is safe to drink. In restaurants, rounding up or leaving 5–10% is normal."),
            E("tip-pharmacy", "Pharmacies", details="A pharmacy is a “Farmácia”, marked with a green cross. Pharmacists give good advice for small health problems."),
            E("tip-taxi", "Taxis", details="Taxis are beige or black-and-green. Ask the hotel to call one. Show the driver the address card from “Say it”."),
        ],
        "contacts": [
            E("hospital", "Hospital de São José (emergency department)", role="hospital", localName="Hospital de São José",
              details="Public hospital with a 24-hour emergency department, 10 minutes from the hotel. In an emergency call 112.",
              address="Rua José António Serrano\n1150-199 Lisboa", lat=38.718199, lng=-9.137945, pinSource="geocode",
              notes="Bring the passport and the insurance certificate."),
            E("sns24", "SNS 24 health line (Portugal)", role="other", details="National health advice line, 24 hours. Choose English.", phone="808 24 24 24"),
            E("embassy", "Embassy of Sweden (demo entry)", role="embassy", details="For lost passports and serious problems.",
              address="Rua Miguel Lupi 12\n1249-077 Lisboa", lat=38.711835, lng=-9.155104, pinSource="geocode",
              notes="DEMO: check the phone number and opening hours at swedenabroad.se before you travel."),
            E("insurance", "Demo Travel Insurance AB", role="insurance", details="Call the claims line before you pay for a doctor or hospital, if you can.",
              phone="+46 00 000 00 00", ref="DEMO-123456", files=["s-insurance.pdf"]),
        ],
    }
    phrases_en = ["Hello, good morning.", "Thank you.", "Please.", "Excuse me.", "Do you speak English?", "I don't understand.",
                  "Where is the toilet?", "The bill, please.", "How much does it cost?", "A table for two, please.",
                  "Still water, please.", "I need a doctor.", "Please call an ambulance.", "Help!",
                  "Where is the nearest pharmacy?", "I am lost.", "Can you write it down, please?", "Can you speak more slowly, please?"]
    phrases_pt = ["Olá, bom dia.", "Obrigado.", "Por favor.", "Com licença.", "Fala inglês?", "Não compreendo.",
                  "Onde fica a casa de banho?", "A conta, por favor.", "Quanto custa?", "Uma mesa para dois, por favor.",
                  "Água sem gás, por favor.", "Preciso de um médico.", "Chame uma ambulância, por favor.", "Socorro!",
                  "Onde fica a farmácia mais próxima?", "Estou perdido.", "Pode escrever, por favor?", "Pode falar mais devagar, por favor?"]
    hints = {1: "A woman says “Obrigada”.", 15: "A woman says “Estou perdida”."}
    phrases = [{"id": f"ph{i}", "en": en, "local": pt, "hint": hints.get(i, "")} for i, (en, pt) in enumerate(zip(phrases_en, phrases_pt))]

    files = {}
    for f in sorted(FILES.iterdir()):
        kind = "pdf" if f.suffix == ".pdf" else "image"
        meta = {"name": f.name.replace("s-", ""), "label": f.stem.replace("s-", "").replace("-", " ").capitalize(), "type": kind, "size": f.stat().st_size}
        if kind == "pdf":
            meta["pages"] = []
        else:
            with Image.open(f) as im:
                meta["w"], meta["h"] = im.size
        files[f.name] = meta
    files["s-eticket.pdf"]["label"] = "E-tickets (both flights)"
    files["s-hotel.pdf"]["label"] = "Hotel confirmation"
    files["s-tram-voucher.pdf"]["label"] = "Tour voucher"
    files["s-insurance.pdf"]["label"] = "Insurance certificate"
    files["s-passport-mum.jpg"]["label"] = "Passport · Mum"
    files["s-passport-dad.jpg"]["label"] = "Passport · Dad"
    files["s-vivaviagem.png"]["label"] = "Viva Viagem card"

    project = {
        "version": 1,
        "settings": {
            "tripName": "Lisbon with Mum & Dad", "shortName": "Lisbon", "shortNameTouched": True,
            "destination": "Lisbon, Portugal", "langName": "Portuguese", "speechLang": "pt-PT", "timeZone": "Europe/Lisbon",
            "emergencyNumber": "112", "myName": "Sam (demo)", "myPhone": "+46 00 000 00 01",
            "icon": {"text": "✈", "color": "#FCB300"},
            "phraseTemplates": {"takeMeTo": "Por favor, leve-me a esta morada:", "whereIs": "Onde fica {place}?"},
            "mapArea": {"bbox": [-9.235, 38.685, -9.085, 38.785], "maxzoom": 15, "file": None, "size": 0, "auto": False},
            "interactiveMap": False, "siteUrl": "",
        },
        "sections": sections, "phrases": phrases, "files": files, "maps": {"list": [], "signature": None},
    }
    (HERE / "sample-project.json").write_text(json.dumps(project, ensure_ascii=False, indent=1), encoding="utf-8")
    print("sample written:", len(files), "files")


if __name__ == "__main__":
    main()
