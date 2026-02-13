import { useEffect, useState, useCallback } from "react";
import {
  Box, Typography, Paper, Table, TableBody, TableCell, TableContainer,
  TableHead, TableRow, Chip, TextField, IconButton, Tooltip, Avatar,
  CircularProgress, Slider,
} from "@mui/material";
import SaveIcon from "@mui/icons-material/Save";
import type { Client } from "@linearapp/shared";
import { getClients, updateClient } from "../api";

type EditingState = {
  id: number;
  weight: number;
  notes: string;
  contractValue: number;
};

export default function CustomersPage() {
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<EditingState | null>(null);
  const [saving, setSaving] = useState(false);

  const fetchClients = useCallback(async () => {
    try {
      setLoading(true);
      const res = await getClients();
      setClients(res.data || []);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load customers");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchClients();
  }, [fetchClients]);

  const startEditing = (client: Client) => {
    setEditing({
      id: client.id,
      weight: client.weight,
      notes: client.notes || "",
      contractValue: client.contractValue || 0,
    });
  };

  const saveEditing = async () => {
    if (!editing) return;
    setSaving(true);
    try {
      const res = await updateClient(editing.id, {
        weight: editing.weight,
        notes: editing.notes || undefined,
        contractValue: editing.contractValue || undefined,
      });
      if (res.data) {
        setClients(prev => prev.map(c => c.id === editing.id ? { ...c, ...res.data } : c));
      }
      setEditing(null);
    } catch (e) {
      console.error("Failed to save:", e);
    } finally {
      setSaving(false);
    }
  };

  const getTierColor = (tier?: string): "default" | "primary" | "secondary" | "success" | "warning" | "error" => {
    if (!tier) return "default";
    const lower = tier.toLowerCase();
    if (lower.includes("enterprise") || lower.includes("platinum")) return "primary";
    if (lower.includes("pro") || lower.includes("gold")) return "secondary";
    if (lower.includes("starter") || lower.includes("silver")) return "success";
    return "default";
  };

  const getWeightColor = (weight: number): string => {
    if (weight >= 3) return "#f44336";
    if (weight >= 2) return "#ff9800";
    if (weight >= 1.5) return "#ffeb3b";
    return "#4caf50";
  };

  // Sort by weight descending
  const sorted = [...clients].sort((a, b) => b.weight - a.weight);

  if (loading) {
    return (
      <Box sx={{ display: "flex", justifyContent: "center", alignItems: "center", height: "60vh" }}>
        <CircularProgress />
      </Box>
    );
  }

  if (error) {
    return (
      <Box sx={{ p: 3 }}>
        <Typography color="error">{error}</Typography>
      </Box>
    );
  }

  return (
    <Box sx={{ p: 3, maxWidth: 1200, mx: "auto" }}>
      <Typography variant="h5" sx={{ mb: 0.5, fontWeight: 600 }}>
        Customers
      </Typography>
      <Typography variant="body2" sx={{ mb: 3, color: "text.secondary" }}>
        Linear customers with EAM-team issues. Adjust weights to prioritize customer work.
      </Typography>

      <TableContainer component={Paper} sx={{ bgcolor: "background.paper" }}>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell sx={{ fontWeight: 600, width: 48 }}></TableCell>
              <TableCell sx={{ fontWeight: 600 }}>Customer</TableCell>
              <TableCell sx={{ fontWeight: 600 }}>Tier</TableCell>
              <TableCell sx={{ fontWeight: 600 }}>Status</TableCell>
              <TableCell sx={{ fontWeight: 600, textAlign: "right" }}>Issues</TableCell>
              <TableCell sx={{ fontWeight: 600, textAlign: "right" }}>Revenue</TableCell>
              <TableCell sx={{ fontWeight: 600, width: 180 }}>Weight</TableCell>
              <TableCell sx={{ fontWeight: 600 }}>Owner</TableCell>
              <TableCell sx={{ fontWeight: 600, width: 40 }}></TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {sorted.map(client => {
              const isEditing = editing?.id === client.id;
              return (
                <TableRow
                  key={client.id}
                  hover
                  onClick={() => !isEditing && startEditing(client)}
                  sx={{ cursor: isEditing ? "default" : "pointer", "&:last-child td": { borderBottom: 0 } }}
                >
                  <TableCell>
                    {client.logoUrl ? (
                      <Avatar src={client.logoUrl} sx={{ width: 32, height: 32 }} />
                    ) : (
                      <Avatar sx={{ width: 32, height: 32, fontSize: 14, bgcolor: "primary.dark" }}>
                        {client.name.charAt(0)}
                      </Avatar>
                    )}
                  </TableCell>
                  <TableCell>
                    <Typography variant="body2" sx={{ fontWeight: 500 }}>{client.name}</Typography>
                    {client.domains.length > 0 && (
                      <Typography variant="caption" sx={{ color: "text.secondary" }}>
                        {client.domains.slice(0, 2).join(", ")}
                      </Typography>
                    )}
                  </TableCell>
                  <TableCell>
                    {client.tier && (
                      <Chip label={client.tier} size="small" color={getTierColor(client.tier)} variant="outlined" />
                    )}
                  </TableCell>
                  <TableCell>
                    <Typography variant="body2">{client.status || "—"}</Typography>
                  </TableCell>
                  <TableCell sx={{ textAlign: "right" }}>
                    <Typography variant="body2" sx={{ fontWeight: 500 }}>{client.issueCount}</Typography>
                  </TableCell>
                  <TableCell sx={{ textAlign: "right" }}>
                    <Typography variant="body2">
                      {client.revenue ? `$${client.revenue.toLocaleString()}` : "—"}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    {isEditing ? (
                      <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                        <Slider
                          value={editing.weight}
                          onChange={(_, val) => setEditing(prev => prev ? { ...prev, weight: val as number } : null)}
                          min={0.1}
                          max={5}
                          step={0.1}
                          size="small"
                          sx={{ width: 100 }}
                          onClick={(e) => e.stopPropagation()}
                        />
                        <Typography variant="body2" sx={{ minWidth: 30, textAlign: "right", fontWeight: 600 }}>
                          {editing.weight.toFixed(1)}
                        </Typography>
                      </Box>
                    ) : (
                      <Tooltip title={`Weight: ${client.weight.toFixed(1)}`}>
                        <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                          <Box
                            sx={{
                              width: Math.max(8, client.weight * 20),
                              height: 8,
                              borderRadius: 1,
                              bgcolor: getWeightColor(client.weight),
                            }}
                          />
                          <Typography variant="body2">{client.weight.toFixed(1)}</Typography>
                        </Box>
                      </Tooltip>
                    )}
                  </TableCell>
                  <TableCell>
                    <Typography variant="body2">{client.ownerName || "—"}</Typography>
                  </TableCell>
                  <TableCell>
                    {isEditing && (
                      <Tooltip title="Save changes">
                        <IconButton
                          size="small"
                          onClick={(e) => { e.stopPropagation(); saveEditing(); }}
                          disabled={saving}
                        >
                          {saving ? <CircularProgress size={18} /> : <SaveIcon fontSize="small" />}
                        </IconButton>
                      </Tooltip>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
            {sorted.length === 0 && (
              <TableRow>
                <TableCell colSpan={9} sx={{ textAlign: "center", py: 4 }}>
                  <Typography variant="body2" sx={{ color: "text.secondary" }}>
                    No customers with EAM-team issues found. Trigger a sync to pull data from Linear.
                  </Typography>
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </TableContainer>

      {editing && (
        <Paper sx={{ mt: 2, p: 2 }}>
          <Typography variant="subtitle2" sx={{ mb: 1 }}>
            Editing: {clients.find(c => c.id === editing.id)?.name}
          </Typography>
          <Box sx={{ display: "flex", gap: 2, flexWrap: "wrap" }}>
            <TextField
              label="Contract Value ($)"
              type="number"
              size="small"
              value={editing.contractValue || ""}
              onChange={(e) => setEditing(prev => prev ? { ...prev, contractValue: Number(e.target.value) || 0 } : null)}
              sx={{ width: 200 }}
            />
            <TextField
              label="Notes"
              size="small"
              multiline
              maxRows={3}
              value={editing.notes}
              onChange={(e) => setEditing(prev => prev ? { ...prev, notes: e.target.value } : null)}
              sx={{ flexGrow: 1, minWidth: 300 }}
            />
          </Box>
        </Paper>
      )}
    </Box>
  );
}
