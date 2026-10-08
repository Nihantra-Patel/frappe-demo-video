"""Reset the demo site to a clean pre-demo state. Run before EVERY take (make-video.sh
calls it automatically, from the bench's `sites` dir using the bench python).

This is a WORKED EXAMPLE SHAPE matching reference-demo.mjs's run() placeholders — it
cancels + force-deletes the demo documents created by the storyboard's "First Doctype"/
"Second Doctype" steps (filtered by a link field pointing at the shared reference
document), and resets the settings-doctype toggle(s) OFF so the "enable" step animates on
camera again on the next take. Replace every "<...>" placeholder with the real doctype/
fieldnames your feature needs — this file is not specific to any one module or app.
Override the site and reference document via env: DEMO_SITE, DEMO_REFERENCE.

If you're using assets/run-flow.mjs instead (the recommended default for a new video —
see SKILL.md), you don't need this file at all: run-flow.mjs tracks every document a run
actually creates and deletes them generically via `--reset-only`, for any doctype, with
nothing hand-written per project.
"""
import frappe, os

SITE = os.environ.get("DEMO_SITE", "mysite.localhost")
REFERENCE = os.environ.get("DEMO_REFERENCE", "<name of the Step-2 reference document>")
LINK_FIELDNAME = "<link_fieldname>"  # the field on "First Doctype"/"Second Doctype" that points at REFERENCE

frappe.init(site=SITE)
frappe.connect()
try:
    for dt in ["<First Doctype>", "<Second Doctype>"]:
        for name in frappe.get_all(dt, filters={LINK_FIELDNAME: REFERENCE}, pluck="name"):
            try:
                doc = frappe.get_doc(dt, name)
                if doc.docstatus == 1:
                    try:
                        doc.cancel()
                    except Exception as e:
                        # linked ledger/stock entries can block a clean cancel; for a
                        # demo test site, force docstatus→0 in the DB so the doc can
                        # still be deleted (orphan linked entries don't affect a
                        # report that reads from these documents on a demo site).
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
    for dt in ["<First Doctype>", "<Second Doctype>"]:
        frappe.db.delete("Comment", {"reference_doctype": dt})
        frappe.db.delete("Version", {"ref_doctype": dt})
        frappe.db.delete("Activity Log", {"reference_doctype": dt})
        frappe.db.delete("Document Follow", {"ref_doctype": dt})
    # Attachments an earlier take produced outlive their parent document.
    for f in frappe.get_all("File", filters={"attached_to_doctype": "<Second Doctype>"}, pluck="name"):
        frappe.delete_doc("File", f, force=1, ignore_permissions=True)
    frappe.db.commit()

    # Straight to the DB, NOT doc.save(): a save files a Version, and the reset then
    # shows up in the settings page's own Activity feed while it is on camera.
    for field, value in (
        ("<enable_fieldname>", 0),
        ("<dependent_fieldname>", ""),
    ):
        frappe.db.set_single_value("<Settings Doctype>", field, value, update_modified=False)
    frappe.db.delete("Version", {"ref_doctype": "<Settings Doctype>"})
    frappe.clear_cache()
    frappe.db.commit()
    print("RESET OK")
finally:
    frappe.destroy()
