# گلشن فیکٹری آن لائن — Render پر Deploy کرنے کا طریقہ

Ye guide aap ko step-by-step batayegi ke Gulshan Factory ka online ordering system
Render (muft/free) par kaise live karein, taake dukaandaar apne mobile se order kar sakein.

---

## Pehle ye cheezein tayyar rakhein

1. **GitHub account** (muft) — https://github.com par sign up karein
2. **Render account** (muft) — https://render.com par sign up karein (GitHub se login ho jata hai)
3. Ye project ka code (gulshan-factory-online folder)

---

## Step 1 — Code GitHub par dalna

1. GitHub par naya repository banayein, naam rakhein: `gulshan-factory-online` (Private bhi chalega)
2. Apne computer par terminal me:
   ```
   cd gulshan-factory-online
   git init
   git add .
   git commit -m "Gulshan Factory online system"
   git branch -M main
   git remote add origin https://github.com/APKA-USERNAME/gulshan-factory-online.git
   git push -u origin main
   ```
   (APKA-USERNAME ki jagah apna GitHub username likhein)

## Step 2 — Render par Blueprint se deploy karna

1. https://dashboard.render.com par login karein
2. Upar **New +** button dabayein → **Blueprint** select karein
3. Apna `gulshan-factory-online` repository select karein
4. Render khud `render.yaml` parhega aur service bana dega — **Apply** dabayein
5. 3–5 minute me build mukammal ho jayega. Aap ko ek link milega, misal:
   `https://gulshan-factory-online.onrender.com`

> `SESSION_SECRET` khud-ba-khud ban jayega (render.yaml me `generateValue` hai). Kuch aur set karne ki zaroorat nahi.

## Step 3 — Pehli dafa Super Admin banana

1. Upar wale link ko browser me kholein
2. Pehli screen par **Super Admin account** banayein (username + password) — bas ek dafa
3. Login karke checklist follow karein: gaari → route → category → unit → items → dukaanein → dukano ke login

## Step 4 — Dukaandaaron ko link dena

- Wahi Render wala link dukaandaaron ko WhatsApp par bhej dein
- Har dukaan apne **username/password** se login karegi (aap Settings → Users me banayenge)
- Har dukaan sirf **apna** order aur apni history dekhegi

---

## Zaroori baatein (ghor se parhein)

- **Muft plan par data:** Render ke muft plan me server ka disk aarzi hota hai — agar service dobara deploy/restart ho to purana data (orders waghera) **mit sakta hai**. Mustaqil data ke liye Render par **Disk** lagayein (paid) ya waqtan-fa-waqtan backup lein.
- **Pehli request slow:** Muft plan par 15 minute istemal na ho to server so jata hai; pehli request me 30–60 second lag sakte hain. Ye normal hai.
- **Password mehfooz rakhein:** Super Admin ka password kisi se share na karein.
- **HTTPS:** Render khud muft HTTPS deta hai — link `https://` se shuru hoga, mehfooz hai.

## Apne computer par chalana (testing ke liye)

```
cd gulshan-factory-online
npm install
npm start
```
Phir browser me kholein: http://localhost:3000
