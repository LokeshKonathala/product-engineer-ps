import { describe, it, expect, vi, beforeEach } from "vitest";

const insertMock = vi.fn();
const broadcastMock = vi.fn();

vi.mock("../src/repositories/updateRepository.js", () => ({
  updateRepository: { insert: insertMock, listAfter: vi.fn() }
}));

vi.mock("../src/websocket/roomManager.js", () => ({
  roomManager: { broadcast: broadcastMock, subscribe: vi.fn(), unsubscribe: vi.fn(), connectionCount: vi.fn() }
}));

// Imported after the mocks so updateService picks up the mocked modules.
const { updateService } = await import("../src/services/updateService.js");

beforeEach(() => {
  insertMock.mockReset();
  broadcastMock.mockReset();
});

describe("updateService.publish — persist-before-broadcast invariant", () => {
  it("broadcasts only after the insert resolves, using the persisted (server-assigned) data", async () => {
    const persisted = {
      id: "11111111-1111-1111-1111-111111111111",
      roomId: "INC-001",
      message: "DB recovered",
      sequence: 43,
      createdAt: "2026-09-18T08:35:00.000Z"
    };
    const callOrder: string[] = [];
    insertMock.mockImplementation(async () => {
      callOrder.push("insert");
      return persisted;
    });
    broadcastMock.mockImplementation(() => {
      callOrder.push("broadcast");
    });

    const result = await updateService.publish({ roomId: "INC-001", message: "DB recovered" });

    expect(callOrder).toEqual(["insert", "broadcast"]);
    expect(broadcastMock).toHaveBeenCalledWith("INC-001", persisted);
    expect(result).toEqual(persisted);
  });

  it("does not broadcast when persistence fails", async () => {
    insertMock.mockRejectedValue(new Error("database is unavailable"));

    await expect(updateService.publish({ roomId: "INC-001", message: "DB recovered" })).rejects.toThrow(
      "database is unavailable"
    );

    expect(broadcastMock).not.toHaveBeenCalled();
  });
});
