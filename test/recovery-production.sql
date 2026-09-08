-- Transactional fixture: no committed rows, no transport or customer outreach.
begin;
do $$
declare c uuid; o recovery_outbox; i recovery_inbox; n integer;
begin
 insert into clients(business_name,niche,whatsapp_numbers,active,recovery_enabled,recovery_sms_number,twilio_voice_number)
 values('Kaspr rollback verification','test','{}',true,true,'+15005550006','+15005550006') returning id into c;
 perform kaspr_capture_missed_call('CA-rollback-verification','+15005550006','+15005550009','no-answer');
 perform kaspr_capture_missed_call('CA-rollback-verification','+15005550006','+15005550009','no-answer');
 select count(*) into n from recovery_outbox where client_id=c;
 if n<>1 then raise exception 'Duplicate call created duplicate outbox'; end if;
 update recovery_outbox set available_at=now() where client_id=c;
 select * into o from kaspr_claim_outbox();
 if o.client_id is distinct from c then raise exception 'Unexpected active queue; abort fixture'; end if;
 perform kaspr_fail_send(o.id,'retry','20429');
 if (select status from recovery_outbox where id=o.id)<>'pending' then raise exception 'Retry not persisted'; end if;
 update recovery_outbox set available_at=now() where id=o.id;
 select * into o from kaspr_claim_outbox();
 perform kaspr_delivery_status(o.id,'SM-rollback-verification','delivered',null);
 perform kaspr_complete_send(o.id,'SM-rollback-verification');
 perform kaspr_delivery_status(o.id,'SM-rollback-verification','queued',null);
 if (select delivery_status from recovery_outbox where id=o.id)<>'delivered' then raise exception 'Delivery regressed'; end if;
 perform kaspr_capture_sms('SM-rollback-reply','+15005550009','+15005550006','Colour');
 perform kaspr_capture_sms('SM-rollback-reply','+15005550009','+15005550006','Colour');
 select count(*) into n from recovery_inbox where sid='SM-rollback-reply';
 if n<>1 then raise exception 'Duplicate SMS'; end if;
 select * into i from kaspr_claim_inbox();
 perform kaspr_finish_reply(i.id,i.lease_until,'time','Colour',null,'test','What time?');
 perform kaspr_finish_reply(i.id,i.lease_until,'time','Colour',null,'test','What time?');
 select count(*) into n from recovery_outbox where client_id=c and kind='reply';
 if n<>1 then raise exception 'Duplicate reply'; end if;
 perform kaspr_booking_transition(o.opportunity_id,c,'appointment_booked','ROLLBACK-BOOKING',280);
 perform kaspr_booking_transition(o.opportunity_id,c,'appointment_completed','ROLLBACK-BOOKING',280);
 perform kaspr_booking_transition(o.opportunity_id,c,'revenue_attributed','ROLLBACK-BOOKING',280);
 perform kaspr_booking_transition(o.opportunity_id,c,'revenue_attributed','ROLLBACK-BOOKING',280);
 select count(*) into n from revenue_events where opportunity_id=o.opportunity_id and event_name='revenue_attributed';
 if n<>1 or (select recovered_value from revenue_opportunities where id=o.opportunity_id)<>280 then raise exception 'Revenue mismatch'; end if;
 perform kaspr_capture_sms('SM-rollback-stop','+15005550009','+15005550006','QUIT');
 if not exists(select 1 from suppressed_contacts where phone='+15005550009' and client_id is null) then raise exception 'STOP missing'; end if;
 if exists(select 1 from recovery_outbox where client_id=c and status='pending') then raise exception 'STOP left pending send'; end if;
end $$;
select 'PASS: duplicate call, retry, delivery ordering, duplicate SMS/reply, booking completion, exact revenue, repeat attribution, STOP' as result;
rollback;
