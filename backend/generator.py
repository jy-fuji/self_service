"""Deterministic plan -> ARM JSON generator.

The LLM never writes the template; this guarantees the deployment is
reproducible, policy-shaped, and reviewable. v1 emits a Microsoft.Storage
storage account per planned resource.
"""


def build_arm(resources):
    arm_resources = []
    for r in resources:
        p = r["params"]
        arm_resources.append({
            "type": "Microsoft.Storage/storageAccounts",
            "apiVersion": "2023-01-01",
            "name": r["naming"],
            "location": p["location"],
            "sku": {"name": p["skuName"]},
            "kind": p.get("kind", "StorageV2"),
            "tags": r["tags"],
            "properties": {
                "minimumTlsVersion": "TLS1_2",
                "allowBlobPublicAccess": False,
                "supportsHttpsTrafficOnly": True,
                "publicNetworkAccess": "Enabled",
            },
        })
    return {
        "$schema": "https://schema.management.azure.com/schemas/2019-04-01/deploymentTemplate.json#",
        "contentVersion": "1.0.0.0",
        "resources": arm_resources,
    }


def arm_preview(resources):
    """A compact, human-readable view of the generated template for the UI."""
    return build_arm(resources)
