import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import "./index.css";
import { session } from "./lib/api";
import Layout from "./components/Layout";
import Login from "./pages/Login";
import PurchaseOrders from "./pages/PurchaseOrders";
import Audit from "./pages/Audit";
import Home from "./pages/Home";
import HR from "./pages/HR";
import SupplyChain from "./pages/SupplyChain";
import CRM from "./pages/CRM";
import Reports from "./pages/Reports";
import Workflow from "./pages/Workflow";
import Organization from "./pages/Organization";
import Finance from "./pages/Finance";
import Security from "./pages/Security";

const Protected = ({ children }: { children: JSX.Element }) => (session.get() ? children : <Navigate to="/login" />);

ReactDOM.createRoot(document.getElementById("root")!).render(
  <BrowserRouter>
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route element={<Protected><Layout /></Protected>}>
        <Route path="/" element={<Home />} />
        <Route path="/hr" element={<HR />} />
        <Route path="/supply-chain" element={<SupplyChain />} />
        <Route path="/crm" element={<CRM />} />
        <Route path="/reports" element={<Reports />} />
        <Route path="/workflow" element={<Workflow />} />
        <Route path="/organization" element={<Organization />} />
        <Route path="/finance" element={<Finance />} />
        <Route path="/security" element={<Security />} />
        <Route path="*" element={<Home />} />
        <Route path="/purchase-orders" element={<PurchaseOrders />} />
        <Route path="/audit" element={<Audit />} />
      </Route>
    </Routes>
  </BrowserRouter>
);
