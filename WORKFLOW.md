# แผนภาพกระบวนการทำงานและคำสั่งทั้งหมด (Workflow & Command Center)

เอกสารสรุปคำสั่งและผังการทำงานทั้งหมดของระบบสำหรับคุณเอกค่ะ

---

## 🎮 สรุปคำสั่งที่ใช้งานได้ในกลุ่ม LINE

```text
┌────────────────────────────────────────────────────────────────────────┐
│  🤖 คำสั่งที่ไอทีสามารถพิมพ์สั่งงานได้ทันที:                           │
├────────────────────────────────────────────────────────────────────────┤
│  1. เมนู / คำสั่ง              👉 แสดงการ์ดแนะนำฟังก์ชันทั้งหมด         │
│  2. [ชื่อ] มีกำหนด ลาออก [วัน]  👉 แจ้งลาออก ปรับ Inactive + คิว 3 เดือน│
│  3. ยกเลิก [ชื่อ]              👉 คืนสถานะ Active + ยกเลิกคิว          │
│  4. เช็คสถานะ [ชื่อ]           👉 ดูสถานะเมลปัจจุบัน + คิวลาออก        │
│  5. กำหนดในเดือนนี้มีใครบ้าง   👉 สรุปรายชื่อที่ครบกำหนดในเดือนนี้     │
│  6. getid                      👉 เช็ค Group ID / User ID              │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 🔄 1. ผังการทำงานเมื่อ "ยกเลิกลาออก" (Cancel Resignation)

```mermaid
sequenceDiagram
    autonumber
    actor IT as ไอทีในกลุ่ม LINE
    participant Webhook as Webhook (doPost)
    participant Master as ชีต: รายชื่อเมลพนักงาน
    participant Queue as ชีต: รายการเมลที่กำหนดออก
    participant LINE as ห้องแชต LINE

    IT->>Webhook: พิมพ์ "ยกเลิกลาออก สมชาย"
    Webhook->>Master: ค้นหา "สมชาย" ➡️ คืนสถานะเมลเป็น "Active"
    Webhook->>Queue: ค้นหาคิวของ สมชาย ➡️ ปรับสถานะเป็น "Cancelled"
    Webhook->>LINE: ส่งการ์ดสีเขียวมิ้นต์ "↩️ ยกเลิกการลาออกสำเร็จ"
    LINE->>IT: สมาชิกในกลุ่มเห็นการ์ดยืนยันทันที
```

---

## 🔄 2. ผังการทำงานเมื่อ "เช็คสถานะพนักงาน" (Check Status)

```mermaid
sequenceDiagram
    autonumber
    actor IT as ไอทีในกลุ่ม LINE
    participant Webhook as Webhook (doPost)
    participant Master as ชีต: รายชื่อเมลพนักงาน
    participant Queue as ชีต: รายการเมลที่กำหนดออก
    participant LINE as ห้องแชต LINE

    IT->>Webhook: พิมพ์ "เช็คสถานะ สมชาย"
    Webhook->>Master: ดึงสถานะเมล (Active/Inactive), อีเมล, แผนก
    Webhook->>Queue: ดึงข้อมูลวันออก, วันครบกำหนด 3 เดือน (ถ้ามี)
    Webhook->>LINE: ส่งการ์ดสีฟ้า "👤 ข้อมูลสถานะพนักงาน" ครบถ้วน
```

---

## 🔄 3. ผังการทำงานเมื่อ "ตรวจเช็ครายการในเดือนนี้" (Due This Month)

```mermaid
sequenceDiagram
    autonumber
    actor IT as ไอทีในกลุ่ม LINE
    participant Webhook as Webhook (doPost)
    participant Queue as ชีต: รายการเมลที่กำหนดออก
    participant LINE as ห้องแชต LINE

    IT->>Webhook: พิมพ์ "กำหนดในเดือนนี้มีใครบ้าง"
    Webhook->>Queue: สแกนแถวที่ DueDate อยู่ในเดือนปัจจุบัน และ Status != 'Cancelled'
    alt มีรายการครบกำหนด
        Webhook->>LINE: ส่งการ์ดสีส้มสรุปรายชื่อ อีเมล และวันครบกำหนด
    else ไม่มีรายการ
        Webhook->>LINE: ตอบกลับ "🎉 ในเดือนนี้ไม่มีเมลพนักงานที่ครบกำหนดจัดการค่ะ"
    end
```
