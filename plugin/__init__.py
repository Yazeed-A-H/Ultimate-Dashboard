"""ultimate-dashboard: the dashboard page ships as desktop/ and dashboard/ assets; this module only lets Hermes load the plugin."""


def register(ctx):
    pass  # empty on purpose: desktop/plugin.js and dashboard/ are discovered by folder, nothing is registered agent-side
