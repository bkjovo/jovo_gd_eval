"""
build_corpus.py — the v2 evaluation corpus: 25 items x 5 languages = 125 queries.

Design goals (see corpus/README.md for the full rationale):
  * Parallel across en/es/fr/de/pt: 23 of 25 items are the same text translated. The
    2 homograph items are language-specific by necessity (a homograph does not survive
    translation) and are marked parallel=False.
  * Domain-relevant: banking, healthcare, customer service, PC gaming (NPC). No
    placeholder text.
  * Deliberate stressors: numbers+units, currency, decimals, URLs, email, acronyms,
    alphanumeric codes, dates/times, phone numbers, proper nouns, loanwords /
    code-switching, percentages, ALL-CAPS emphasis, long prosody, very short, and
    homographs (the real TTS pronunciation-disambiguation stressor; NOT homophones,
    which stress STT, not TTS).
  * Locale formatting: numbers, currency, dates and times are written the way each
    language actually writes them (4.250,75 vs 4,250.75, 24h vs 12h, etc.).
  * Length varied, capped so the longest language (usually German) stays under ~20 s.

Each base item carries: use_case, stress_category, difficulty, and a challenge_note
saying WHY it is hard. Homograph items add per-language notes because the phenomenon
differs by language.

Emits:  corpus/manifest_125.jsonl   (run_batch.py-compatible, one row per clip)
Prints: character counts per language and an estimated API cost for several run modes.

Run:  python corpus/build_corpus.py
"""

import json
from pathlib import Path

# Voice roster (see ../voices.json). NOT persona-matched yet — Jules (fr) is an
# expressive outlier; re-pick before treating cross-language prosody as controlled.
VOICES = {
    "en": ("r2sIQdqqoqgRJuXw", "Marcus"),
    "es": ("sVLgzKMqaptUdaY8", "Mateo"),
    "fr": ("YKeBw3OV1RgpdhLh", "Jules"),
    "de": ("Kf5m22mROozoMWj3", "Mats"),
    "pt": ("EzmLkNorEpZG_oNv", "Rodrigo"),
}
LANGS = ["en", "es", "fr", "de", "pt"]

# ---------------------------------------------------------------------------
# The 25 base items. `t` holds the per-language text. For homograph items, `ln`
# holds a per-language challenge note (the tricky word differs by language).
# ---------------------------------------------------------------------------
ITEMS = [
    # ---------------- BANKING ----------------
    {
        "id": "bank-01", "use_case": "banking", "stress_category": "currency_decimal",
        "difficulty": "medium", "parallel": True,
        "note": "Currency amount with a decimal; separator and currency word are locale-specific (USD->EUR, 4,250.75 vs 4.250,75).",
        "t": {
            "en": "Your available balance is 4,250.75 dollars.",
            "es": "Su saldo disponible es de 4.250,75 euros.",
            "fr": "Votre solde disponible est de 4 250,75 euros.",
            "de": "Ihr verfügbares Guthaben beträgt 4.250,75 Euro.",
            "pt": "O seu saldo disponível é de 4.250,75 euros.",
        },
    },
    {
        "id": "bank-02", "use_case": "banking", "stress_category": "alphanumeric_code",
        "difficulty": "medium", "parallel": True,
        "note": "Spelled-out alphanumeric code; letter names (A, K) are pronounced differently in each language.",
        "t": {
            "en": "Your confirmation code is A, 7, 3, 9, K, 2.",
            "es": "Su código de confirmación es A, 7, 3, 9, K, 2.",
            "fr": "Votre code de confirmation est A, 7, 3, 9, K, 2.",
            "de": "Ihr Bestätigungscode lautet A, 7, 3, 9, K, 2.",
            "pt": "O seu código de confirmação é A, 7, 3, 9, K, 2.",
        },
    },
    {
        "id": "bank-03", "use_case": "banking", "stress_category": "url",
        "difficulty": "medium", "parallel": True,
        "note": "Web address with a domain and a slash path; the spoken word for '/' differs by language.",
        "t": {
            "en": "To report fraud, go to secure.mybank.com slash help.",
            "es": "Para denunciar un fraude, visite secure.mybank.com barra help.",
            "fr": "Pour signaler une fraude, allez sur secure.mybank.com slash help.",
            "de": "Um Betrug zu melden, gehen Sie auf secure.mybank.com Schrägstrich help.",
            "pt": "Para denunciar uma fraude, aceda a secure.mybank.com barra help.",
        },
    },
    {
        "id": "bank-04", "use_case": "banking", "stress_category": "phone_number",
        "difficulty": "medium", "parallel": True,
        "note": "Phone number read as grouped digits; grouping conventions vary.",
        "t": {
            "en": "Call our fraud line at 0800 45 77 90 right away.",
            "es": "Llame de inmediato a nuestra línea antifraude: 0800 45 77 90.",
            "fr": "Appelez tout de suite notre service antifraude au 0800 45 77 90.",
            "de": "Rufen Sie sofort unsere Betrugs-Hotline an: 0800 45 77 90.",
            "pt": "Ligue já para a nossa linha antifraude: 0800 45 77 90.",
        },
    },
    {
        "id": "bank-05", "use_case": "banking", "stress_category": "digit_string",
        "difficulty": "hard", "parallel": True,
        "note": "Long grouped account number; tests digit grouping and sustained number reading.",
        "t": {
            "en": "Send the wire to account 4021 8837 0005.",
            "es": "Envíe la transferencia a la cuenta 4021 8837 0005.",
            "fr": "Envoyez le virement sur le compte 4021 8837 0005.",
            "de": "Überweisen Sie auf das Konto 4021 8837 0005.",
            "pt": "Envie a transferência para a conta 4021 8837 0005.",
        },
    },
    {
        "id": "bank-06", "use_case": "banking", "stress_category": "acronym",
        "difficulty": "easy", "parallel": True,
        "note": "Acronym PIN; ATM localizes to the regional term (cajero / distributeur / Geldautomat / multibanco).",
        "t": {
            "en": "Enter your PIN at any ATM to withdraw cash.",
            "es": "Introduzca su PIN en cualquier cajero para sacar dinero.",
            "fr": "Saisissez votre code PIN à tout distributeur pour retirer de l'argent.",
            "de": "Geben Sie Ihre PIN an jedem Geldautomaten ein, um Geld abzuheben.",
            "pt": "Introduza o seu PIN em qualquer multibanco para levantar dinheiro.",
        },
    },
    # ---------------- HEALTHCARE ----------------
    {
        "id": "health-01", "use_case": "healthcare", "stress_category": "numbers_units",
        "difficulty": "medium", "parallel": True,
        "note": "Dosage: unit (milligrams), drug name, and an interval number.",
        "t": {
            "en": "Take 500 milligrams of ibuprofen every 8 hours.",
            "es": "Tome 500 miligramos de ibuprofeno cada 8 horas.",
            "fr": "Prenez 500 milligrammes d'ibuprofène toutes les 8 heures.",
            "de": "Nehmen Sie 500 Milligramm Ibuprofen alle 8 Stunden.",
            "pt": "Tome 500 miligramas de ibuprofeno de 8 em 8 horas.",
        },
    },
    {
        "id": "health-02", "use_case": "healthcare", "stress_category": "date_time_proper_noun",
        "difficulty": "medium", "parallel": True,
        "note": "Proper noun (Alvarez), a date, and a time in locale format (9:30 vs 9 h 30).",
        "t": {
            "en": "Doctor Alvarez will see you on May 6th at 9:30.",
            "es": "El doctor Álvarez le atenderá el 6 de mayo a las 9:30.",
            "fr": "Le docteur Alvarez vous recevra le 6 mai à 9 h 30.",
            "de": "Doktor Alvarez empfängt Sie am 6. Mai um 9:30 Uhr.",
            "pt": "O doutor Álvarez vai recebê-lo no dia 6 de maio às 9:30.",
        },
    },
    {
        "id": "health-03", "use_case": "healthcare", "stress_category": "acronym",
        "difficulty": "hard", "parallel": True,
        "note": "Three medical acronyms, each localized (MRI->IRM/RM/MRT, EKG->ECG, CT->TAC/scanner).",
        "t": {
            "en": "The patient needs an MRI, an EKG, and a CT scan.",
            "es": "El paciente necesita una RM, un ECG y un TAC.",
            "fr": "Le patient a besoin d'une IRM, d'un ECG et d'un scanner.",
            "de": "Der Patient braucht ein MRT, ein EKG und ein CT.",
            "pt": "O paciente precisa de uma RM, de um ECG e de uma TAC.",
        },
    },
    {
        "id": "health-04", "use_case": "healthcare", "stress_category": "homograph",
        "difficulty": "hard", "parallel": False,
        "note": "Pronunciation disambiguation. Language-specific: the tricky word differs and does not translate.",
        "ln": {
            "en": "homograph 'read' — past tense /rɛd/, not present /riːd/.",
            "es": "no true homograph in Spanish; substitutes hard clinical terminology (disnea paroxística).",
            "fr": "homograph 'fils' — sons /fis/, not threads /fil/.",
            "de": "no clean homograph; substitutes a long compound term (Blutdruckmessung) + medical term.",
            "pt": "homograph 'colher' — spoon /kuˈʎɛɾ/, not to-harvest /kuˈʎeɾ/.",
        },
        "t": {
            "en": "I read the patient's chart before the exam.",
            "es": "El médico evaluó la disnea paroxística nocturna del paciente.",
            "fr": "Mes fils ont lu le dossier médical hier soir.",
            "de": "Die Blutdruckmessung ergab eine deutliche Hypertonie.",
            "pt": "Tome uma colher de xarope antes de dormir.",
        },
    },
    {
        "id": "health-05", "use_case": "healthcare", "stress_category": "decimal_units",
        "difficulty": "medium", "parallel": True,
        "note": "Decimal temperature (locale comma) with a unit, plus a bare pulse number.",
        "t": {
            "en": "Your temperature is 38.5 degrees and your pulse is 72.",
            "es": "Su temperatura es de 38,5 grados y su pulso es de 72.",
            "fr": "Votre température est de 38,5 degrés et votre pouls est de 72.",
            "de": "Ihre Temperatur beträgt 38,5 Grad und Ihr Puls liegt bei 72.",
            "pt": "A sua temperatura é de 38,5 graus e a pulsação é de 72.",
        },
    },
    {
        "id": "health-06", "use_case": "healthcare", "stress_category": "url",
        "difficulty": "medium", "parallel": True,
        "note": "Web address with domain and slash path in a clinical instruction.",
        "t": {
            "en": "Refill your prescription at care.example.org slash refill.",
            "es": "Renueve su receta en care.example.org barra refill.",
            "fr": "Renouvelez votre ordonnance sur care.example.org slash refill.",
            "de": "Erneuern Sie Ihr Rezept auf care.example.org Schrägstrich refill.",
            "pt": "Renove a sua receita em care.example.org barra refill.",
        },
    },
    # ---------------- CUSTOMER SERVICE ----------------
    {
        "id": "cs-01", "use_case": "customer_service", "stress_category": "very_short_question",
        "difficulty": "easy", "parallel": True,
        "note": "Very short opener; tests clean question intonation on a brief utterance.",
        "t": {
            "en": "Thank you for calling. How can I help?",
            "es": "Gracias por llamar. ¿En qué puedo ayudarle?",
            "fr": "Merci de votre appel. Comment puis-je vous aider ?",
            "de": "Danke für Ihren Anruf. Wie kann ich helfen?",
            "pt": "Obrigado por ligar. Como posso ajudar?",
        },
    },
    {
        "id": "cs-02", "use_case": "customer_service", "stress_category": "alphanumeric_code",
        "difficulty": "medium", "parallel": True,
        "note": "Order number mixing digits, a spoken punctuation word (dash), and a letter.",
        "t": {
            "en": "Your order number is 6, 2, 9, dash, T, 4.",
            "es": "Su número de pedido es 6, 2, 9, guion, T, 4.",
            "fr": "Votre numéro de commande est 6, 2, 9, tiret, T, 4.",
            "de": "Ihre Bestellnummer ist 6, 2, 9, Bindestrich, T, 4.",
            "pt": "O seu número de encomenda é 6, 2, 9, hífen, T, 4.",
        },
    },
    {
        "id": "cs-03", "use_case": "customer_service", "stress_category": "time_days",
        "difficulty": "medium", "parallel": True,
        "note": "Opening hours: weekday range and times; 12-hour (en) vs 24-hour (others).",
        "t": {
            "en": "We're open Monday to Friday, 8 a.m. to 6 p.m.",
            "es": "Abrimos de lunes a viernes, de 8 a 18 h.",
            "fr": "Nous sommes ouverts du lundi au vendredi, de 8 h à 18 h.",
            "de": "Wir haben Montag bis Freitag von 8 bis 18 Uhr geöffnet.",
            "pt": "Estamos abertos de segunda a sexta, das 8h às 18h.",
        },
    },
    {
        "id": "cs-04", "use_case": "customer_service", "stress_category": "url_code",
        "difficulty": "hard", "parallel": True,
        "note": "Web address plus an inline alphanumeric tracking code in one breath.",
        "t": {
            "en": "Track your parcel at track.ship.com with code R229.",
            "es": "Siga su paquete en track.ship.com con el código R229.",
            "fr": "Suivez votre colis sur track.ship.com avec le code R229.",
            "de": "Verfolgen Sie Ihr Paket auf track.ship.com mit dem Code R229.",
            "pt": "Acompanhe a sua encomenda em track.ship.com com o código R229.",
        },
    },
    {
        "id": "cs-05", "use_case": "customer_service", "stress_category": "currency_decimal",
        "difficulty": "medium", "parallel": True,
        "note": "Refund amount with cents; decimal separator is locale-specific.",
        "t": {
            "en": "We've refunded 129.99 euros to your card.",
            "es": "Le hemos devuelto 129,99 euros a su tarjeta.",
            "fr": "Nous avons remboursé 129,99 euros sur votre carte.",
            "de": "Wir haben 129,99 Euro auf Ihre Karte erstattet.",
            "pt": "Reembolsámos 129,99 euros no seu cartão.",
        },
    },
    {
        "id": "cs-06", "use_case": "customer_service", "stress_category": "long_prosody",
        "difficulty": "hard", "parallel": True,
        "note": "Long multi-clause apology with a semicolon; tests prosody drift and empathetic intonation (~8-10 s).",
        "t": {
            "en": "I am truly sorry for the delay, and I understand how frustrating this has been; let me fix it for you right now.",
            "es": "Lamento mucho la demora y entiendo lo frustrante que ha sido; permítame solucionarlo ahora mismo.",
            "fr": "Je suis vraiment désolé pour ce retard et je comprends à quel point c'est frustrant ; laissez-moi arranger cela tout de suite.",
            "de": "Es tut mir sehr leid für die Verzögerung, und ich verstehe, wie frustrierend das war; lassen Sie mich das sofort für Sie regeln.",
            "pt": "Lamento imenso o atraso e compreendo como isto foi frustrante; deixe-me resolver isto agora mesmo.",
        },
    },
    {
        "id": "cs-07", "use_case": "customer_service", "stress_category": "percentage",
        "difficulty": "medium", "parallel": True,
        "note": "Percentage in an offer; 'percent' vs 'por ciento' vs 'pour cent' vs 'Prozent'.",
        "t": {
            "en": "As an apology, here's 20 percent off your next order.",
            "es": "Como disculpa, le ofrecemos un 20 por ciento de descuento en su próximo pedido.",
            "fr": "Pour nous excuser, voici 20 pour cent de réduction sur votre prochaine commande.",
            "de": "Als Entschuldigung erhalten Sie 20 Prozent Rabatt auf Ihre nächste Bestellung.",
            "pt": "Como pedido de desculpas, oferecemos 20 por cento de desconto na próxima encomenda.",
        },
    },
    # ---------------- PC GAMING / NPC ----------------
    {
        "id": "game-01", "use_case": "gaming_npc", "stress_category": "proper_noun",
        "difficulty": "hard", "parallel": True,
        "note": "Invented English fantasy proper nouns (Eldergrove, Thorne) — hard for non-English TTS to pronounce.",
        "t": {
            "en": "Travel to Eldergrove and find the blacksmith, Thorne.",
            "es": "Viaja a Eldergrove y busca al herrero, Thorne.",
            "fr": "Voyage jusqu'à Eldergrove et trouve le forgeron, Thorne.",
            "de": "Reise nach Eldergrove und finde den Schmied Thorne.",
            "pt": "Viaja até Eldergrove e encontra o ferreiro, Thorne.",
        },
    },
    {
        "id": "game-02", "use_case": "gaming_npc", "stress_category": "acronym_percentage",
        "difficulty": "medium", "parallel": True,
        "note": "Gaming acronym XP (kept English across languages), a number, and a percentage.",
        "t": {
            "en": "You earned 250 XP and your health is at 80 percent.",
            "es": "Ganaste 250 XP y tu salud está al 80 por ciento.",
            "fr": "Tu as gagné 250 XP et ta santé est à 80 pour cent.",
            "de": "Du hast 250 XP erhalten und deine Gesundheit liegt bei 80 Prozent.",
            "pt": "Ganhaste 250 XP e a tua vida está a 80 por cento.",
        },
    },
    {
        "id": "game-03", "use_case": "gaming_npc", "stress_category": "alphanumeric_code",
        "difficulty": "medium", "parallel": True,
        "note": "Redemption code; 'skin' is an English loanword in fr/de.",
        "t": {
            "en": "Enter the code G, 7, X, 4, 9 to unlock the skin.",
            "es": "Introduce el código G, 7, X, 4, 9 para desbloquear el aspecto.",
            "fr": "Entre le code G, 7, X, 4, 9 pour débloquer le skin.",
            "de": "Gib den Code G, 7, X, 4, 9 ein, um den Skin freizuschalten.",
            "pt": "Introduz o código G, 7, X, 4, 9 para desbloquear o visual.",
        },
    },
    {
        "id": "game-04", "use_case": "gaming_npc", "stress_category": "caps_emphasis",
        "difficulty": "medium", "parallel": True,
        "note": "ALL-CAPS emphasis word plus exclamation; tests emphatic prosody.",
        "t": {
            "en": "You shall NOT pass without the ancient key!",
            "es": "¡NO pasarás sin la llave antigua!",
            "fr": "Tu ne passeras PAS sans la clé ancienne !",
            "de": "Du wirst OHNE den alten Schlüssel NICHT vorbeikommen!",
            "pt": "Tu NÃO passarás sem a chave antiga!",
        },
    },
    {
        "id": "game-05", "use_case": "gaming_npc", "stress_category": "loanword_codeswitch",
        "difficulty": "hard", "parallel": True,
        "note": "Embedded English tech loanwords (driver, lag) inside a non-English sentence — code-switch pronunciation.",
        "t": {
            "en": "Update your graphics driver and restart to fix the lag.",
            "es": "Actualiza el driver de gráficos y reinicia para arreglar el lag.",
            "fr": "Mets à jour ton driver graphique et redémarre pour corriger le lag.",
            "de": "Aktualisiere deinen Grafiktreiber und starte neu, um den Lag zu beheben.",
            "pt": "Atualiza o driver gráfico e reinicia para corrigir o lag.",
        },
    },
    {
        "id": "game-06", "use_case": "gaming_npc", "stress_category": "homograph",
        "difficulty": "hard", "parallel": False,
        "note": "Pronunciation disambiguation. Language-specific: the tricky word differs and does not translate.",
        "ln": {
            "en": "homograph 'lead' — verb /liːd/, not the metal /lɛd/.",
            "es": "no true homograph in Spanish; substitutes a hard invented proper noun (Xólotl).",
            "fr": "double homograph 'fils' (/fis/) and 'content' (verb /kɔ̃t/, not adj /kɔ̃tɑ̃/).",
            "de": "homograph 'umfahren' — drive around /ʊmˈfaːʀən/, not run over /ˈʊmfaːʀən/.",
            "pt": "homograph 'sede' — thirst /ˈse.dɨ/, not headquarters /ˈsɛ.dɨ/.",
        },
        "t": {
            "en": "Lead the party through the cave to the throne.",
            "es": "Invoca a Xólotl para cruzar el abismo en llamas.",
            "fr": "Les fils du roi content leur victoire au village.",
            "de": "Der Krieger muss das brennende Hindernis umfahren.",
            "pt": "O guerreiro tem sede de vitória nesta batalha.",
        },
    },
]


def rows():
    for it in ITEMS:
        for lang in LANGS:
            vid, vname = VOICES[lang]
            note = it["note"]
            if not it["parallel"] and "ln" in it:
                note = it["ln"][lang]
            yield {
                "id": f"{it['id']}-{lang}",
                "base_id": it["id"],
                "lang": lang,
                "text": it["t"][lang],
                "voice_id": vid,
                "voice_name": vname,
                "difficulty": it["difficulty"],
                "use_case": it["use_case"],
                "stress_category": it["stress_category"],
                "parallel": it["parallel"],
                "challenge_note": note,
            }


def main():
    out = Path(__file__).parent / "manifest_125.jsonl"
    all_rows = list(rows())
    with open(out, "w", encoding="utf-8") as f:
        for r in all_rows:
            f.write(json.dumps(r, ensure_ascii=False) + "\n")

    # --- character counts (the real cost driver) ---
    by_lang = {L: 0 for L in LANGS}
    for r in all_rows:
        by_lang[r["lang"]] += len(r["text"])
    total = sum(by_lang.values())

    print(f"wrote {out}  ({len(all_rows)} rows: {len(ITEMS)} items x {len(LANGS)} languages)\n")
    print("characters per language:")
    for L in LANGS:
        print(f"  {L}: {by_lang[L]:>5}  ({by_lang[L]/len(ITEMS):.0f} avg/item)")
    print(f"  total: {total} characters\n")

    # --- cost estimate ---
    # Gradium bills per synthesized character (run_batch estimator: sum(len(text)) *
    # calls_per_item). Credits below assume 1 credit == 1 character; if the real ratio
    # differs, scale linearly — the character count is the ground truth.
    modes = {
        "quality only (1 synth/item, no latency)": 1,
        "quality + 1 warmup + 1 latency trial (3/item)": 3,
        "quality + 1 warmup + 5 latency trials (7/item)": 7,
    }
    print("estimated cost by run mode (credits ~= characters x calls/item):")
    for name, calls in modes.items():
        print(f"  {total*calls:>7} credits  <- {name}")

    # Stratified latency: quality on all 125, full latency only on a length-balanced
    # subset (3 short + 3 medium + 3 long per language ~= 45 clips) at 6 extra calls.
    subset_ids = {"cs-01", "bank-06", "game-04",      # short
                  "bank-01", "health-01", "game-02",   # medium
                  "cs-06", "game-06", "health-04"}      # long
    subset_chars = sum(len(r["text"]) for r in all_rows if r["base_id"] in subset_ids)
    stratified = total * 1 + subset_chars * 6
    print(f"  {stratified:>7} credits  <- quality on all 125 + latency (5 trials) on a "
          f"{len(subset_ids)*len(LANGS)}-clip length-stratified subset  [RECOMMENDED]")


if __name__ == "__main__":
    main()
