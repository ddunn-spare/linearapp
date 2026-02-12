import { useState } from "react";
import {
  Box, Button, Typography, CircularProgress,
  Collapse, Fade,
} from "@mui/material";
import BuildIcon from "@mui/icons-material/Build";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import ErrorIcon from "@mui/icons-material/Error";
import CancelIcon from "@mui/icons-material/Cancel";
import ArrowForwardIcon from "@mui/icons-material/ArrowForward";
import type { ActionProposal, ActionState } from "@linearapp/shared";

export type ApprovalCardProps = {
  proposal: ActionProposal;
  onApprove: (id: string) => void;
  onDecline: (id: string) => void;
  onRetry: (id: string) => void;
};

// --- Shared transition styles ---
const TRANSITION_DURATION = 150;
const COLLAPSE_DURATION = 280;

// --- State-based container styles ---
function getContainerSx(state: ActionState) {
  const base = {
    borderRadius: 2,
    border: "1px solid",
    px: 2,
    py: 1.5,
    transition: `border-color ${TRANSITION_DURATION}ms ease, background-color ${TRANSITION_DURATION}ms ease`,
  };

  switch (state) {
    case "proposed":
      return { ...base, bgcolor: "rgba(33, 150, 243, 0.06)", borderColor: "rgba(33, 150, 243, 0.2)" };
    case "approved":
    case "executing":
      return {
        ...base,
        bgcolor: "rgba(33, 150, 243, 0.04)",
        borderColor: "rgba(33, 150, 243, 0.3)",
        animation: "approvalPulse 2s ease-in-out infinite",
        "@keyframes approvalPulse": {
          "0%, 100%": { borderColor: "rgba(33, 150, 243, 0.3)" },
          "50%": { borderColor: "rgba(33, 150, 243, 0.6)" },
        },
      };
    case "succeeded":
      return { ...base, bgcolor: "rgba(76, 175, 80, 0.06)", borderColor: "rgba(76, 175, 80, 0.2)", py: 1 };
    case "failed":
      return { ...base, bgcolor: "rgba(244, 67, 54, 0.06)", borderColor: "rgba(244, 67, 54, 0.3)" };
    case "declined":
      return { ...base, bgcolor: "rgba(255, 255, 255, 0.02)", borderColor: "rgba(255, 255, 255, 0.08)", py: 1 };
    default:
      return base;
  }
}

// --- Preview field row ---
function PreviewField({ field, oldValue, newValue }: { field: string; oldValue?: string; newValue: string }) {
  return (
    <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, py: 0.5 }}>
      <Typography
        variant="caption"
        sx={{ color: "text.secondary", minWidth: 80, fontSize: "0.75rem", textTransform: "capitalize" }}
      >
        {field}
      </Typography>
      {oldValue ? (
        <>
          <Typography
            variant="body2"
            sx={{
              textDecoration: "line-through",
              color: "rgba(244, 67, 54, 0.7)",
              fontSize: "0.8rem",
            }}
          >
            {oldValue}
          </Typography>
          <ArrowForwardIcon sx={{ fontSize: 12, color: "text.secondary" }} />
          <Typography
            variant="body2"
            sx={{ color: "rgba(76, 175, 80, 0.9)", fontSize: "0.8rem", fontWeight: 500 }}
          >
            {newValue}
          </Typography>
        </>
      ) : (
        <Typography
          variant="body2"
          sx={{ color: "rgba(76, 175, 80, 0.9)", fontSize: "0.8rem", fontWeight: 500 }}
        >
          {newValue}
        </Typography>
      )}
    </Box>
  );
}

// --- Main Component ---
export default function ApprovalCard({ proposal, onApprove, onDecline, onRetry }: ApprovalCardProps) {
  const [approveDisabled, setApproveDisabled] = useState(false);
  const { state } = proposal;

  const handleApprove = () => {
    setApproveDisabled(true);
    onApprove(proposal.id);
  };

  const handleDecline = () => {
    onDecline(proposal.id);
  };

  const handleRetry = () => {
    onRetry(proposal.id);
  };

  return (
    <Collapse in timeout={COLLAPSE_DURATION}>
      <Box key={`${proposal.id}-${state}`} sx={getContainerSx(state)}>
        {/* ── Proposed: full card ── */}
        {state === "proposed" && (
          <Fade in timeout={TRANSITION_DURATION}>
            <Box>
              {/* Header */}
              <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 1 }}>
                <BuildIcon sx={{ fontSize: 16, color: "rgba(33, 150, 243, 0.7)" }} />
                <Typography variant="body2" sx={{ fontWeight: 500, fontSize: "0.85rem" }}>
                  {proposal.description}
                </Typography>
              </Box>

              {/* Preview fields */}
              {proposal.preview && proposal.preview.length > 0 && (
                <Box sx={{ mb: 1.5, pl: 3.25 }}>
                  {proposal.preview.map((field) => (
                    <PreviewField
                      key={field.field}
                      field={field.field}
                      oldValue={field.oldValue}
                      newValue={field.newValue}
                    />
                  ))}
                </Box>
              )}

              {/* Buttons */}
              <Box sx={{ display: "flex", gap: 1, pl: 3.25 }}>
                <Button
                  variant="contained"
                  color="primary"
                  size="small"
                  disabled={approveDisabled}
                  onClick={handleApprove}
                  sx={{ fontSize: "0.75rem", py: 0.5, px: 2 }}
                >
                  Approve
                </Button>
                <Button
                  variant="text"
                  color="inherit"
                  size="small"
                  onClick={handleDecline}
                  sx={{ fontSize: "0.75rem", py: 0.5, px: 1.5, color: "text.secondary" }}
                >
                  Decline
                </Button>
              </Box>
            </Box>
          </Fade>
        )}

        {/* ── Executing: spinner replaces buttons ── */}
        {(state === "approved" || state === "executing") && (
          <Fade in timeout={TRANSITION_DURATION}>
            <Box>
              {/* Header */}
              <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 1 }}>
                <BuildIcon sx={{ fontSize: 16, color: "rgba(33, 150, 243, 0.7)" }} />
                <Typography variant="body2" sx={{ fontWeight: 500, fontSize: "0.85rem" }}>
                  {proposal.description}
                </Typography>
              </Box>

              {/* Preview fields - slightly faded */}
              {proposal.preview && proposal.preview.length > 0 && (
                <Box sx={{ mb: 1.5, pl: 3.25, opacity: 0.6 }}>
                  {proposal.preview.map((field) => (
                    <PreviewField
                      key={field.field}
                      field={field.field}
                      oldValue={field.oldValue}
                      newValue={field.newValue}
                    />
                  ))}
                </Box>
              )}

              {/* Spinner */}
              <Box sx={{ display: "flex", alignItems: "center", gap: 1, pl: 3.25 }}>
                <CircularProgress size={16} sx={{ color: "primary.main" }} />
                <Typography variant="body2" sx={{ color: "text.secondary", fontSize: "0.8rem" }}>
                  Executing...
                </Typography>
              </Box>
            </Box>
          </Fade>
        )}

        {/* ── Succeeded: compact single-line ── */}
        {state === "succeeded" && (
          <Fade in timeout={TRANSITION_DURATION}>
            <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
              <CheckCircleIcon sx={{ fontSize: 18, color: "success.main" }} />
              {proposal.resultUrl ? (
                <Typography
                  component="a"
                  href={proposal.resultUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  variant="body2"
                  sx={{
                    color: "success.main",
                    fontSize: "0.85rem",
                    textDecoration: "none",
                    "&:hover": { textDecoration: "underline" },
                  }}
                >
                  {proposal.result || "Action completed"}
                </Typography>
              ) : (
                <Typography variant="body2" sx={{ color: "success.main", fontSize: "0.85rem" }}>
                  {proposal.result || "Action completed"}
                </Typography>
              )}
            </Box>
          </Fade>
        )}

        {/* ── Failed: error with retry ── */}
        {state === "failed" && (
          <Fade in timeout={TRANSITION_DURATION}>
            <Box>
              <Box sx={{ display: "flex", alignItems: "flex-start", gap: 1, mb: 1 }}>
                <ErrorIcon sx={{ fontSize: 18, color: "error.main", mt: 0.25 }} />
                <Typography variant="body2" sx={{ color: "error.main", fontSize: "0.85rem" }}>
                  {proposal.error || "Action failed"}
                </Typography>
              </Box>
              <Box sx={{ pl: 3.25 }}>
                <Button
                  variant="outlined"
                  color="error"
                  size="small"
                  onClick={handleRetry}
                  sx={{ fontSize: "0.75rem", py: 0.5, px: 2 }}
                >
                  Retry
                </Button>
              </Box>
            </Box>
          </Fade>
        )}

        {/* ── Declined: muted compact line ── */}
        {state === "declined" && (
          <Fade in timeout={TRANSITION_DURATION}>
            <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
              <CancelIcon sx={{ fontSize: 18, color: "text.secondary", opacity: 0.6 }} />
              <Typography variant="body2" sx={{ color: "text.secondary", fontSize: "0.85rem", opacity: 0.7 }}>
                Declined
              </Typography>
            </Box>
          </Fade>
        )}
      </Box>
    </Collapse>
  );
}
