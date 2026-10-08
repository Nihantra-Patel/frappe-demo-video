"""Doctype schema lookup for planning a demo storyboard — prints a compact JSON
summary of frappe.get_meta(doctype) so you don't have to open and read the raw
doctype .json by hand before writing setField() calls.

This is a LOOKUP TOOL, not an auto-storyboard generator: it tells you which
fields exist, their type, and which are mandatory — a human still decides what
the video should actually show and writes run() by hand. Metadata alone
cannot see doctype-specific client-script behavior (fetch_from triggers,
depends_on visibility that reads other field values, custom validate() logic),
so treat this as the replacement for "read the doctype JSON", not as a
replacement for the dry-run step in the Workflow section of SKILL.md — still
prove the flow server-side before recording.

Usage:
  bench --site <site> execute --args '["Item"]' \
    /path/to/get-schema.py:get_schema
  (or copy the body into a bench console session)

Override the site via env: DEMO_SITE.
"""
import frappe, os, json, sys


def get_schema(doctype):
    frappe.init(site=os.environ.get("DEMO_SITE", "mysite.localhost"))
    frappe.connect()
    try:
        meta = frappe.get_meta(doctype)
        fields = []
        mandatory = []
        tables = []
        for df in meta.fields:
            if df.fieldtype in ("Section Break", "Column Break", "Tab Break", "HTML", "Heading"):
                continue
            entry = {
                "fieldname": df.fieldname,
                "label": df.label,
                "fieldtype": df.fieldtype,
                "reqd": bool(df.reqd),
                "options": df.options if df.fieldtype in ("Link", "Select", "Table") else None,
                "depends_on": df.depends_on or None,
                "read_only": bool(df.read_only),
                "hidden": bool(df.hidden),
                "default": df.default or None,
            }
            fields.append(entry)
            if df.reqd:
                mandatory.append(df.fieldname)
            if df.fieldtype == "Table":
                tables.append({"fieldname": df.fieldname, "child_doctype": df.options})

        result = {
            "doctype": doctype,
            "is_submittable": bool(meta.is_submittable),
            "autoname": meta.autoname,
            "mandatory": mandatory,
            "tables": tables,
            "fields": fields,
        }
        print(json.dumps(result, indent=2, default=str))
        return result
    finally:
        frappe.destroy()


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python get-schema.py <doctype>", file=sys.stderr)
        sys.exit(1)
    get_schema(sys.argv[1])
