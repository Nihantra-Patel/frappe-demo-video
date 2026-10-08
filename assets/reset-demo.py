"""Reset the demo site to a clean pre-demo state. Run before EVERY take (make-video.sh
calls it automatically, from the bench's `sites` dir using the bench python).

This is a WORKED EXAMPLE for the India Payroll flow: it cancels + force-deletes the demo
employee's Salary Slips and Salary Structure Assignments (force bypasses submit/link
checks), and turns the India Payroll toggles OFF so the "enable" step animates on camera.
Adapt the doctypes / filters / settings to whatever your feature needs. Override the site
and demo employee via env: DEMO_SITE, DEMO_EMP.
"""
import frappe, os

SITE = os.environ.get("DEMO_SITE", "mysite.localhost")
EMP = os.environ.get("DEMO_EMP", "HR-EMP-00001")

frappe.init(site=SITE)
frappe.connect()
try:
    for dt in ["Salary Slip", "Salary Structure Assignment"]:
        for name in frappe.get_all(dt, filters={"employee": EMP}, pluck="name"):
            try:
                doc = frappe.get_doc(dt, name)
                if doc.docstatus == 1:
                    try:
                        doc.cancel()
                    except Exception as e:
                        # linked ledger entries can block a clean cancel; for a
                        # demo test site, force docstatus→0 in the DB so the doc
                        # can be deleted (orphan GL entries don't affect the
                        # ESIC/LWF registers, which read from salary slips).
                        print("  cancel failed, forcing docstatus=0:", str(e)[:60])
                        frappe.db.set_value(dt, name, "docstatus", 0)
                        frappe.db.commit()
            except Exception:
                pass
            frappe.delete_doc(dt, name, force=1, ignore_permissions=True, delete_permanently=True)
            frappe.db.commit()
            print("  deleted", dt, name)

    # A doctype whose name is DETERMINISTIC (a naming series built from the data, not a
    # hash) has the previous take's history reattach itself to the new document, so its
    # Activity feed reads "you submitted this 20 minutes ago" seconds after creation.
    # Deleting the doc does not clear these; delete them explicitly.
    for dt in ["Salary Slip", "Salary Structure Assignment"]:
        frappe.db.delete("Comment", {"reference_doctype": dt})
        frappe.db.delete("Version", {"ref_doctype": dt})
        frappe.db.delete("Activity Log", {"reference_doctype": dt})
        frappe.db.delete("Document Follow", {"ref_doctype": dt})
    # Attachments an earlier take produced outlive their parent document.
    for f in frappe.get_all("File", filters={"attached_to_doctype": "Salary Slip"}, pluck="name"):
        frappe.delete_doc("File", f, force=1, ignore_permissions=True)
    frappe.db.commit()

    # Straight to the DB, NOT ps.save(): a save files a Version, and the reset then shows
    # up in the settings page's own Activity feed while it is on camera.
    for field, value in (
        ("enable_professional_tax", 0),
        ("enable_esic", 0),
        ("enable_lwf", 0),
        ("esic_registration_number", ""),
    ):
        frappe.db.set_single_value("Payroll Settings", field, value, update_modified=False)
    frappe.db.delete("Version", {"ref_doctype": "Payroll Settings"})
    frappe.clear_cache()
    frappe.db.commit()
    print("RESET OK")
finally:
    frappe.destroy()
