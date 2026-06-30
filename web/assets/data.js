/* Static reference content for the UI (governance + illustrative charts).
   Live data — requests, plans, resources, standards — comes from the API. */
(function () {
  "use strict";

  const POLICY = {
    initiative: "Self-Service Guardrails (sandbox)",
    rules: [
      { id: "allowed-locations", name: "Allowed locations", effect: "Deny", desc: "dev: westus2, eastus only", compliant: true },
      { id: "require-tag-env", name: "Require tag 'env'", effect: "Deny", desc: "Mandatory env tag", compliant: true },
      { id: "require-tag-owner", name: "Require tag 'owner'", effect: "Deny", desc: "Mandatory owner tag", compliant: true },
      { id: "require-tag-cc", name: "Require tag 'costCenter'", effect: "Deny", desc: "Mandatory costCenter tag", compliant: true },
      { id: "allowed-storage-sku", name: "Allowed storage SKUs", effect: "Deny", desc: "Bronze tier: Standard_LRS for dev", compliant: true },
      { id: "secure-transfer", name: "Secure transfer required", effect: "Audit", desc: "HTTPS-only on storage", compliant: true },
    ],
  };

  const RBAC = {
    customRole: "Self-Service Requestor",
    permissions: [
      "Read — Microsoft.ResourceGraph/resources",
      "No resource write (request only, never deploy directly)",
      "Deploying principal: Contributor scoped to the sandbox resource group",
    ],
    pim: {
      role: "Contributor (scoped to the sandbox resource group)",
      principal: "sp-selfservice-demo",
      activation: "Service principal / managed identity — least privilege, single RG",
    },
  };

  // Illustrative chart seeds (the dashboard also overlays live counts).
  const VOLUME_14D = [3, 5, 2, 6, 4, 1, 2, 7, 5, 4, 6, 3, 5, 4];
  const PROVISION_DIST = [
    { label: "<20s", v: 14 }, { label: "20–40s", v: 23 }, { label: "40–60s", v: 11 },
    { label: "1–2m", v: 6 }, { label: ">2m", v: 2 },
  ];

  window.REF = { POLICY, RBAC, VOLUME_14D, PROVISION_DIST };
})();
