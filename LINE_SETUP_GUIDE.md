# คู่มือการตั้งค่า LINE Official Account & Messaging API

เอกสารนี้จะแนะนำขั้นตอนการออก **Channel Access Token** และการหา **Target ID (User ID หรือ Group ID)** เพื่อนำไปใส่ในระบบแจ้งเตือนค่ะ

---

## ขั้นตอนที่ 1: เปิดใช้งาน LINE Messaging API

1. ล็อกอินเข้าสู่ [LINE Developers Console](https://developers.line.biz/console/) ด้วยบัญชี LINE ส่วนตัวหรือ Business
2. เลือกหรือสร้าง **Provider** (เช่น `Company-IT-Operations`)
3. คลิก **Create a new channel** เลือกประเภท **Messaging API**
4. กรอกข้อมูลพื้นฐาน:
   - **Channel name**: เช่น `IT Email Retention Bot`
   - **Channel description**: ระบบแจ้งเตือนเมลพนักงานลาออก
   - **Category / Subcategory**: เลือกหมวดหมู่ที่เกี่ยวข้อง
5. กดยอมรับเงื่อนไขและคลิก **Create**

---

## ขั้นตอนที่ 2: ออก Channel Access Token (Long-Lived)

1. เข้าไปที่ Channel ที่สร้างไว้
2. เลือกแท็บ **Messaging API**
3. เลื่อนลงมาล่างสุดที่หัวข้อ **Channel access token**
4. คลิกปุ่ม **Issue**
5. คัดลอกข้อความ Token ยาวๆ นั้นเก็บไว้ (นี่คือค่า `LINE_CHANNEL_ACCESS_TOKEN`)

---

## ขั้นตอนที่ 3: การหาค่า Target ID (User ID หรือ Group ID)

### กรณีที่ 1: แจ้งเตือนเข้า LINE ส่วนตัวของผู้ดูแลระบบ (User ID)
1. ในหน้า [LINE Developers Console](https://developers.line.biz/console/)
2. เลือกแท็บ **Basic settings**
3. เลื่อนลงมาที่หัวข้อ **Your user ID** (จะขึ้นต้นด้วย `U...` เช่น `U1234567890abcdef...`)
4. คัดลอกค่านั้นมาใช้เป็น `LINE_TARGET_ID` ได้ทันที

> **ข้อสังเกต**: ต้องเพิ่มเพื่อนกับบอทตัวนี้ก่อน (สแกน QR Code ในแท็บ Messaging API) บอทจึงจะสามารถ Push ข้อความเข้ามาหาคุณเอกได้

---

### กรณีที่ 2: แจ้งเตือนเข้า LINE Group ของทีมไอที (Group ID)
หากต้องการให้แจ้งเตือนเข้าห้องแชตกลุ่มเพื่อให้ทีมงานเห็นพร้อมกัน (รหัสจะขึ้นต้นด้วยตัว `C...` เช่น `C1234567890abcdef...`)

แอนได้เขียนฟังก์ชันตรวจหา Group ID อัตโนมัติไว้ในโค้ดเรียบร้อยแล้วค่ะ โดยมี 2 วิธีง่ายๆ:

- **วิธีที่ง่ายที่สุด (พิมพ์คำว่า getid)**:
  1. ดึงบอทเข้ากลุ่ม LINE ของทีมไอที
  2. พิมพ์คำว่า **`getid`** หรือ **`ไอดีกลุ่ม`** ในแชตกลุ่ม
  3. บอทจะตอบกลับมาทันทีว่า:
     ```text
     🆔 GROUP ID ของคุณคือ:
     C1234567890abcdef1234567890abcdef
     👉 นำค่านี้ไปใส่ในช่อง LINE_TARGET_ID ใน Apps Script ได้เลยค่ะ
     ```
  4. คัดลอกค่านั้นมาใช้ได้ทันทีค่ะ

- **วิธีเมื่อเชิญบอทเข้ากลุ่มครั้งแรก**:
  - เมื่อคุณเอกกดเชิญบอทเข้ากลุ่ม บอทจะส่งข้อความทักทายพร้อมแจ้ง Group ID ของกลุ่มนั้นให้ทันทีอัตโนมัติค่ะ

---

## ขั้นตอนที่ 4: การนำค่าไปใส่ใน Apps Script อย่างปลอดภัย

เพื่อความปลอดภัยสูงสุด ไม่ควรเขียน Token ฮาร์ดโค้ดลงในโค้ดดิบ:
1. ในหน้า **Apps Script Editor** คลิกไอคอนรูปฟันเฟือง ⚙️ **การตั้งค่าโครงการ (Project Settings)** ทางซ้ายมือ
2. เลื่อนลงมาที่หัวข้อ **คุณสมบัติของสคริปต์ (Script Properties)**
3. คลิก **แก้ไขคุณสมบัติของสคริปต์ (Edit script properties)** > **เพิ่มคุณสมบัติ (Add script property)**:
   - Property: `LINE_CHANNEL_ACCESS_TOKEN` | Value: *(ใส่ Token ที่ได้จากขั้นตอนที่ 2)*
   - Property: `LINE_TARGET_ID` | Value: *(ใส่ User ID หรือ Group ID ที่ได้จากขั้นตอนที่ 3)*
4. คลิก **บันทึกคุณสมบัติของสคริปต์ (Save script properties)**

*สคริปต์ `Code.gs` ที่แอนเขียนไว้จะดึงค่าจาก Script Properties โดยอัตโนมัติค่ะ*
